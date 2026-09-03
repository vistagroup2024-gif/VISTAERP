-- 282 Staff user access control: login window, data restrictions, voucher rights.
--
-- Brings the three controls the old accounting software had on a staff user, and
-- that this ERP had no equivalent of, onto profiles:
--
--   Login window  — a start/end date and a start/end time. Outside it the user
--                   is not a staff user at all: is_staff() goes false, so every
--                   RLS policy in the database closes with it, not just the UI.
--   Restrict      — the accounts / products / cost centres / tag areas a user is
--                   allowed to work with. A restriction is a subtree: naming a
--                   group covers everything under it. Enforced by RLS on the
--                   four master tables, so every picker, list and voucher line
--                   is filtered without each screen having to remember to.
--   Voucher rights— per voucher and per report screen: access / create / edit /
--                   delete / print, plus edit-others' and edit-authorised.
--
-- Both restrictions and rights follow the permission model already here: an
-- EMPTY setting means unrestricted, so no existing user changes behaviour, and
-- admins are exempt from all three.

-- ── profiles ────────────────────────────────────────────────────────────────
alter table profiles
  add column if not exists login_date_from date,
  add column if not exists login_date_to   date,
  add column if not exists login_time_from time,
  add column if not exists login_time_to   time,
  add column if not exists scope_exclude   jsonb not null default '{}'::jsonb,
  add column if not exists doc_rights      jsonb not null default '{}'::jsonb;

comment on column profiles.scope_exclude is
  'Per restriction kind: true = the listed nodes are the DENIED set instead of the allowed set (the old software''s "Exclude Accounts / Products / Tags").';
comment on column profiles.doc_rights is
  'Per voucher/report screen: {"receipt": {"access": true, "edit": false, ...}}. Empty = every screen, every right.';

-- ── the restriction lists ───────────────────────────────────────────────────
create table if not exists staff_scopes (
  user_id uuid not null references profiles(id) on delete cascade,
  kind    text not null check (kind in ('account', 'product', 'cost_center', 'tag_area')),
  ref_id  uuid not null,
  primary key (user_id, kind, ref_id)
);
create index if not exists staff_scopes_user_kind on staff_scopes(user_id, kind);

alter table staff_scopes enable row level security;
drop policy if exists staff_scopes_read on staff_scopes;
create policy staff_scopes_read on staff_scopes for select
  using (user_id = auth.uid() or has_role('admin'));
drop policy if exists staff_scopes_admin on staff_scopes;
create policy staff_scopes_admin on staff_scopes for all
  using (has_role('admin')) with check (has_role('admin'));

-- ── login window ────────────────────────────────────────────────────────────
-- Saudi local time: the window an admin types is the wall clock the staff read.
-- A window whose start is later than its end runs overnight (22:00 → 06:00).
create or replace function public.staff_login_ok(p_id uuid default null)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select p.is_active
       and (exists (select 1 from user_roles r where r.user_id = p.id and r.role = 'admin')
            or (
              (p.login_date_from is null or (now() at time zone 'Asia/Riyadh')::date >= p.login_date_from)
          and (p.login_date_to   is null or (now() at time zone 'Asia/Riyadh')::date <= p.login_date_to)
          and (p.login_time_from is null or p.login_time_to is null
               or case when p.login_time_from <= p.login_time_to
                    then (now() at time zone 'Asia/Riyadh')::time between p.login_time_from and p.login_time_to
                    else (now() at time zone 'Asia/Riyadh')::time >= p.login_time_from
                      or (now() at time zone 'Asia/Riyadh')::time <= p.login_time_to
                  end)
            ))
    from profiles p where p.id = coalesce(p_id, auth.uid())
  ), false);
$$;

-- is_staff() now carries the window and the active flag. Everything gated on it
-- — every RLS policy, every voucher RPC — closes when the user is out of hours
-- or blocked, instead of the UI being the only thing in the way.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select staff_login_ok();
$$;

-- ── restriction sets ────────────────────────────────────────────────────────
-- Returns the ids a user may work with for one kind, or NULL for "no
-- restriction". Listing a group covers its whole subtree; with the kind's
-- exclude flag set, the subtree is what is taken away instead.
--
-- Deliberately takes no per-row argument: the planner evaluates it ONCE per
-- query, so putting it in an RLS policy costs one extra scan of the master
-- table, not one call per row.
create or replace function public.staff_scope_ids(p_kind text)
returns uuid[] language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid  uuid := auth.uid();
  v_tbl  text;
  v_ids  uuid[];
  v_excl boolean;
  v_out  uuid[];
begin
  if v_uid is null or has_role('admin') then return null; end if;
  v_tbl := case p_kind
             when 'account'     then 'accounts'
             when 'product'     then 'acct_products'
             when 'cost_center' then 'acct_cost_centers'
             when 'tag_area'    then 'acct_tag_areas'
           end;
  if v_tbl is null then return null; end if;

  select array_agg(ref_id) into v_ids from staff_scopes where user_id = v_uid and kind = p_kind;
  if v_ids is null then return null; end if;

  select coalesce((scope_exclude ->> p_kind)::boolean, false) into v_excl from profiles where id = v_uid;

  execute format($q$
    with recursive down as (
      select id from %1$I where id = any($1)
      union all
      select t.id from %1$I t join down d on t.parent_id = d.id
    )
    select case when $2
      then (select coalesce(array_agg(x.id), '{}'::uuid[]) from %1$I x where x.id not in (select id from down))
      else (select coalesce(array_agg(id), '{}'::uuid[]) from down)
    end
  $q$, v_tbl) into v_out using v_ids, v_excl;

  return v_out;
end $$;

-- One id against a restriction set. For code that holds a single id already.
create or replace function public.staff_scope_ok(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_id is null
      or staff_scope_ids(p_kind) is null
      or p_id = any(staff_scope_ids(p_kind));
$$;

-- ── master data RLS carries the restriction ─────────────────────────────────
-- WITH CHECK stays unrestricted: a master a restricted user is allowed to add
-- is not blocked by a set computed before the row exists. Reading, editing and
-- deleting are what the restriction is for.
drop policy if exists accounts_staff on accounts;
create policy accounts_staff on accounts for all
  using (company_id = auth_company_id() and is_staff()
         and (staff_scope_ids('account') is null or id = any(staff_scope_ids('account'))))
  with check (company_id = auth_company_id() and is_staff());

drop policy if exists acct_products_staff on acct_products;
create policy acct_products_staff on acct_products for all
  using (company_id = auth_company_id() and is_staff()
         and (staff_scope_ids('product') is null or id = any(staff_scope_ids('product'))))
  with check (company_id = auth_company_id() and is_staff());

drop policy if exists acct_cost_centers_staff on acct_cost_centers;
create policy acct_cost_centers_staff on acct_cost_centers for all
  using (company_id = auth_company_id() and is_staff()
         and (staff_scope_ids('cost_center') is null or id = any(staff_scope_ids('cost_center'))))
  with check (company_id = auth_company_id() and is_staff());

drop policy if exists acct_tag_areas_staff on acct_tag_areas;
create policy acct_tag_areas_staff on acct_tag_areas for all
  using (company_id = auth_company_id() and is_staff()
         and (staff_scope_ids('tag_area') is null or id = any(staff_scope_ids('tag_area'))))
  with check (company_id = auth_company_id() and is_staff());

-- ── voucher rights ──────────────────────────────────────────────────────────
create or replace function public.staff_doc_right(p_doc text, p_right text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if has_role('admin') then return true; end if;
  select doc_rights into v from profiles where id = auth.uid();
  if v is null or v = '{}'::jsonb then return true; end if;   -- not configured = full access
  return coalesce((v -> p_doc ->> p_right)::boolean, false);
end $$;

-- ── a user cannot widen their own access ────────────────────────────────────
-- profiles_self_update lets a user write their own row (name, phone). Without
-- this an ordinary user could clear their own permissions map — and an empty
-- map means unrestricted — or move their own login window.
create or replace function public.profiles_guard_self_security()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.id = auth.uid() and not has_role('admin') then
    if new.permissions          is distinct from old.permissions
    or new.doc_rights           is distinct from old.doc_rights
    or new.scope_exclude        is distinct from old.scope_exclude
    or new.is_active            is distinct from old.is_active
    or new.company_id           is distinct from old.company_id
    or new.acct_authorize_limit is distinct from old.acct_authorize_limit
    or new.login_date_from      is distinct from old.login_date_from
    or new.login_date_to        is distinct from old.login_date_to
    or new.login_time_from      is distinct from old.login_time_from
    or new.login_time_to        is distinct from old.login_time_to then
      raise exception 'Only an admin can change your access settings';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_self_security on profiles;
create trigger profiles_guard_self_security before update on profiles
  for each row execute function profiles_guard_self_security();

-- ── what the app reads on every request ─────────────────────────────────────
create or replace function public.staff_access()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'is_admin',    has_role('admin'),
    'full_name',   (select full_name from profiles where id = auth.uid()),
    'permissions', coalesce((select permissions from profiles where id = auth.uid()), '{}'::jsonb),
    'doc_rights',  coalesce((select doc_rights  from profiles where id = auth.uid()), '{}'::jsonb),
    'login_ok',    staff_login_ok(),
    'is_active',   coalesce((select is_active from profiles where id = auth.uid()), false),
    'login_window', (select jsonb_build_object(
                       'date_from', login_date_from, 'date_to', login_date_to,
                       'time_from', login_time_from, 'time_to', login_time_to)
                     from profiles where id = auth.uid())
  );
$$;

-- ── admin: read and write one user's access ─────────────────────────────────
create or replace function public.staff_user_access(p_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'doc_rights',    coalesce(p.doc_rights, '{}'::jsonb),
    'scope_exclude', coalesce(p.scope_exclude, '{}'::jsonb),
    'login_date_from', p.login_date_from, 'login_date_to', p.login_date_to,
    'login_time_from', p.login_time_from, 'login_time_to', p.login_time_to,
    'scopes', coalesce((
      select jsonb_object_agg(kind, ids) from (
        select kind, jsonb_agg(ref_id) as ids from staff_scopes where user_id = p.id group by kind
      ) s), '{}'::jsonb)
  )
  from profiles p
  where p.id = p_id and p.company_id = auth_company_id() and has_role('admin');
$$;

-- Saves the whole Access / Restrict / login-window side of a user in one call,
-- so a half-saved user is not a state the screen can leave behind.
create or replace function public.staff_user_set_access(
  p_id uuid, p_doc_rights jsonb, p_scopes jsonb, p_scope_exclude jsonb,
  p_login_date_from date, p_login_date_to date,
  p_login_time_from time, p_login_time_to time)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_kind text; v_id uuid;
begin
  if not has_role('admin') then raise exception 'Only admins can change user access'; end if;
  if not exists (select 1 from profiles where id = p_id and company_id = auth_company_id()) then
    raise exception 'User not found';
  end if;

  update profiles set
    doc_rights      = coalesce(p_doc_rights, '{}'::jsonb),
    scope_exclude   = coalesce(p_scope_exclude, '{}'::jsonb),
    login_date_from = p_login_date_from,
    login_date_to   = p_login_date_to,
    login_time_from = p_login_time_from,
    login_time_to   = p_login_time_to
  where id = p_id;

  delete from staff_scopes where user_id = p_id;
  for v_kind in select jsonb_object_keys(coalesce(p_scopes, '{}'::jsonb)) loop
    if v_kind not in ('account', 'product', 'cost_center', 'tag_area') then
      raise exception 'Unknown restriction %', v_kind;
    end if;
    for v_id in select (jsonb_array_elements_text(p_scopes -> v_kind))::uuid loop
      insert into staff_scopes(user_id, kind, ref_id) values (p_id, v_kind, v_id)
      on conflict do nothing;
    end loop;
  end loop;
end $$;

revoke all on function public.staff_user_set_access(uuid, jsonb, jsonb, jsonb, date, date, time, time) from anon;
revoke all on function public.staff_user_access(uuid) from anon;

-- ── reports honour the account restriction ──────────────────────────────────
-- These are security definer, so RLS on accounts does not reach them; they have
-- to ask for the set themselves.
create or replace function public.acct_ledger(p_company uuid, p_account_ids uuid[], p_from date, p_to date)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with allowed as (
    select case when staff_scope_ids('account') is null then p_account_ids
                else array(select unnest(p_account_ids) intersect select unnest(staff_scope_ids('account')))
           end as ids
  )
  select jsonb_build_object(
    'opening', coalesce((
      select sum(l.debit - l.credit) from journal_lines l
      join journal_entries e on e.id = l.entry_id
      where e.company_id = p_company and e.status = 'posted'
        and l.account_id in (select unnest(ids) from allowed)
        and (p_from is null or e.entry_date < p_from)
    ), 0),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_id', e.id, 'date', e.entry_date, 'entry_no', e.entry_no, 'account_id', l.account_id,
        'account', a.code || ' · ' || a.name, 'memo', coalesce(l.description, e.memo),
        'reference', e.reference, 'debit', l.debit, 'credit', l.credit
      ) order by e.entry_date, e.entry_no, l.created_at)
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
      where e.company_id = p_company and e.status = 'posted'
        and l.account_id in (select unnest(ids) from allowed)
        and (p_from is null or e.entry_date >= p_from)
        and (p_to   is null or e.entry_date <= p_to)
    ), '[]'::jsonb)
  );
$$;

create or replace function public.trial_balance(p_company uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with agg as (
    select a.id, a.code, a.name, a.type as nature,
      coalesce(sum(l.debit - l.credit) filter (where p_from is null or e.entry_date < p_from),0) as opening_net,
      coalesce(sum(l.debit)  filter (where (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)),0) as period_debit,
      coalesce(sum(l.credit) filter (where (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)),0) as period_credit
    from accounts a
    left join journal_lines l on l.account_id = a.id
    left join journal_entries e on e.id = l.entry_id and e.company_id = p_company and e.status = 'posted'
    where a.company_id = p_company and a.is_postable
      and (staff_scope_ids('account') is null or a.id = any(staff_scope_ids('account')))
    group by a.id, a.code, a.name, a.type
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'code', code, 'name', name, 'nature', nature,
    'opening_debit',  case when opening_net > 0 then opening_net else 0 end,
    'opening_credit', case when opening_net < 0 then -opening_net else 0 end,
    'period_debit', period_debit, 'period_credit', period_credit,
    'closing_net', opening_net + period_debit - period_credit
  ) order by code), '[]'::jsonb)
  from agg
  where opening_net <> 0 or period_debit <> 0 or period_credit <> 0;
$$;
