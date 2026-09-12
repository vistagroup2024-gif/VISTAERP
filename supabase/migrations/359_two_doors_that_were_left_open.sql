-- An ERP-wide sweep found two doors standing open, and both were mine.
--
-- ── 1. THE AUTOMATION REGISTRY WAS WORLD-WRITABLE ────────────────────────
--
-- acct_automation_events and acct_automation_actions (migration 345) were
-- created without `enable row level security`. This project grants the table
-- privileges to anon and authenticated wholesale, and RLS is what normally
-- stands behind that — so with it off, measured on the live database:
--
--     anon: DELETE, INSERT, SELECT, TRUNCATE, UPDATE
--
-- The anon key ships in the browser bundle, so anon means anybody. Those two
-- tables are the registry that says WHICH events post to the general ledger and
-- WHICH accounts they hit. Anyone could have added a row, rewritten one, or
-- truncated the pair.
--
-- Nothing in the app reads them directly — every reader is an RPC
-- (acct_automation_dispatch, acct_automation_status_ok, the settings screen's
-- own loader), all of them definer — so turning RLS on with a staff-only SELECT
-- policy and taking the write grants away breaks no screen. Checked before
-- writing this: `grep -rn acct_automation_events app components lib` is empty.
--
-- They are seeded by migration and read by routines. Nobody types into them, so
-- nobody needs write access at all.
--
-- ── 2. car_post_charges_month WAS ANON-CALLABLE WITH NO GATE ─────────────
--
-- Migration 350 added it and never revoked the PUBLIC default, so:
--
--     security definer + anon has execute + no is_staff(), no p_secret, nothing
--
-- It posts the monthly service-charge journal for a company. This is exactly
-- what CLAUDE.md warns about under "revoke ... from anon is not a gate" — the
-- same shape as car_post_contract, which migration 293 found running to
-- completion as anon.
--
-- Its only caller is car_monthly_run, which is definer and checks CRON_SECRET.
-- A definer function runs as its owner, so it can still call this with no grant
-- at all — and leaving it ungranted is what makes it internal, the same
-- property the *_post_now routines rely on.
--
-- ── 3. FIVE FUNCTIONS WITH A ROLE-MUTABLE search_path ───────────────────
--
-- All five are recent and all five are pure — they touch no table — so nothing
-- leaked. But they resolve built-ins (round, date_trunc, replace,
-- regexp_replace) through whatever search_path the caller has, and they are
-- called from inside definer routines. Pinning it costs nothing and the linter
-- is right to ask.
--
-- Their volatility, arguments and bodies are unchanged; only `set search_path`
-- is added, and the PUBLIC default grant is taken off the ones that have no
-- business being reachable without a session.

begin;

-- ── 1 ──────────────────────────────────────────────────────────────────────
alter table public.acct_automation_events  enable row level security;
alter table public.acct_automation_actions enable row level security;

drop policy if exists acct_automation_events_staff on public.acct_automation_events;
create policy acct_automation_events_staff on public.acct_automation_events
  for select using ((select is_staff()));

drop policy if exists acct_automation_actions_staff on public.acct_automation_actions;
create policy acct_automation_actions_staff on public.acct_automation_actions
  for select using ((select is_staff()));

-- No policy for insert/update/delete, and the grants go too. A registry seeded
-- by migration needs neither.
revoke insert, update, delete, truncate, references, trigger
  on public.acct_automation_events  from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.acct_automation_actions from anon, authenticated;
revoke all on public.acct_automation_events  from anon;
revoke all on public.acct_automation_actions from anon;
grant select on public.acct_automation_events  to authenticated;
grant select on public.acct_automation_actions to authenticated;

-- ── 2 ──────────────────────────────────────────────────────────────────────
revoke all on function public.car_post_charges_month(uuid, date) from public, anon, authenticated;

-- ── 3 ──────────────────────────────────────────────────────────────────────
create or replace function public.trade_doc_fx(p_meta jsonb)
returns numeric
language sql
immutable
set search_path to 'public'
as $f$
  select case when coalesce((p_meta->>'fx_rate')::numeric, 1) > 0
              then coalesce((p_meta->>'fx_rate')::numeric, 1)
              else 1 end;
$f$;
revoke all on function public.trade_doc_fx(jsonb) from public, anon;
grant execute on function public.trade_doc_fx(jsonb) to authenticated;

create or replace function public.car_charge_for_month(p_month date, p_delivered date, p_full numeric)
returns numeric
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_delivered is null or p_month is null then 0
    when date_trunc('month', p_month) < date_trunc('month', p_delivered) then 0
    when date_trunc('month', p_month) > date_trunc('month', p_delivered) then coalesce(p_full, 0)
    when extract(day from p_delivered) <= 4  then coalesce(p_full, 0)
    when extract(day from p_delivered) <= 15 then round(coalesce(p_full, 0) / 2, 2)
    else 0
  end;
$function$;
revoke all on function public.car_charge_for_month(date, date, numeric) from public, anon;
grant execute on function public.car_charge_for_month(date, date, numeric) to authenticated;

create or replace function public.notif_render(p_template text, p_vars jsonb)
returns text
language plpgsql
immutable
set search_path to 'public'
as $f$
declare k text; v text; out_text text := coalesce(p_template, '');
begin
  for k, v in select key, coalesce(value, '') from jsonb_each_text(coalesce(p_vars, '{}'::jsonb))
  loop
    out_text := replace(out_text, '{' || k || '}', v);
  end loop;
  -- anything still in braces was not supplied
  return btrim(regexp_replace(out_text, '\{[a-z_]+\}', '', 'g'));
end $f$;
revoke all on function public.notif_render(text, jsonb) from public, anon;
grant execute on function public.notif_render(text, jsonb) to authenticated;

create or replace function public.notif_rule_title(p_rule notification_rules, p_threshold int)
returns text
language sql
immutable
set search_path to 'public'
as $f$
  select coalesce(nullif(p_rule.titles->>(p_threshold::text), ''), p_rule.title);
$f$;
revoke all on function public.notif_rule_title(notification_rules, int) from public, anon;
grant execute on function public.notif_rule_title(notification_rules, int) to authenticated;

-- notification_categories keeps `authenticated` — notify_prefs_get / _save read
-- it and the Notification Preferences screen goes through those. It is a list of
-- seven category names either way; anon simply has no use for it.
create or replace function public.notification_categories()
returns jsonb
language sql
immutable
set search_path to 'public'
as $function$
  select jsonb_build_array(
    jsonb_build_object('category','accounting','label','Voucher authorisation',
      'gated_by', null,
      'description','A voucher is waiting on your approval, or one you raised was approved or rejected.'),
    jsonb_build_object('category','visa','label','Visa & groups',
      'gated_by','visa',
      'description','Visa issued, group created, package update required.'),
    jsonb_build_object('category','transport','label','Transport',
      'gated_by','transport',
      'description','Drivers assigned, tafweej required, a cancellation asked for.'),
    jsonb_build_object('category','hotel','label','Hotels',
      'gated_by','hotels',
      'description','Booking confirmed, HCN not received, hotel reminders.'),
    jsonb_build_object('category','brn','label','BRN allocation',
      'gated_by','brn',
      'description','BRNs allocated to a group.'),
    jsonb_build_object('category','package','label','Package updates',
      'gated_by','visa',
      'description','A group''s package needs updating.'),
    jsonb_build_object('category','system','label','Payments & system',
      'gated_by', null,
      'description','Payment required, and anything the ERP raises that is not one of the above.')
  );
$function$;
revoke all on function public.notification_categories() from public, anon;
grant execute on function public.notification_categories() to authenticated;

do $chk$
declare v_n int; v_names text;
begin
  -- 1. both registries closed
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('acct_automation_events','acct_automation_actions')
     and not c.relrowsecurity;
  if v_n <> 0 then raise exception '359: % automation registry table(s) still have RLS off', v_n; end if;

  select coalesce(string_agg(distinct table_name || '/' || privilege_type, ', '), '') into v_names
    from information_schema.role_table_grants
   where table_schema='public'
     and table_name in ('acct_automation_events','acct_automation_actions')
     and grantee in ('anon','public')
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_names <> '' then raise exception '359: anon can still write the registry: %', v_names; end if;

  -- 2. the engine is internal again
  if has_function_privilege('anon', 'public.car_post_charges_month(uuid,date)', 'execute') then
    raise exception '359: car_post_charges_month is still anon-callable';
  end if;
  if has_function_privilege('authenticated', 'public.car_post_charges_month(uuid,date)', 'execute') then
    raise exception '359: car_post_charges_month is still granted to authenticated';
  end if;

  -- Its one real caller must still be able to reach it. car_monthly_run is
  -- security definer and owned by postgres, so the privilege that matters for
  -- the internal call is the OWNER's — not anon's and not authenticated's.
  -- Checked directly rather than by calling car_monthly_run, which would raise
  -- on the secret long before it got anywhere near this function and would
  -- therefore prove nothing.
  if not has_function_privilege('postgres', 'public.car_post_charges_month(uuid,date)', 'execute') then
    raise exception '359: the owner can no longer execute car_post_charges_month, so car_monthly_run is broken';
  end if;
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='car_monthly_run') is not true then
    raise exception '359: car_monthly_run is not security definer, so it cannot reach an internal engine';
  end if;
  -- and the wrong secret is still refused, which is the gate that replaced the grant
  begin
    perform car_monthly_run('deliberately-wrong');
    raise exception '359: car_monthly_run accepted a wrong secret';
  exception when others then
    if sqlerrm not ilike '%secret%' then
      raise exception '359: car_monthly_run refused a wrong secret for the wrong reason: %', sqlerrm;
    end if;
  end;

  -- 3. no function left with a mutable search_path among the five
  select coalesce(string_agg(p.proname, ', '), '') into v_names
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('trade_doc_fx','car_charge_for_month','notification_categories',
                       'notif_render','notif_rule_title')
     and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');
  if v_names <> '' then raise exception '359: still role-mutable: %', v_names; end if;

  -- the five still answer the same
  if trade_doc_fx('{"fx_rate":3.75}'::jsonb) <> 3.75 then raise exception '359: trade_doc_fx changed'; end if;
  if trade_doc_fx('{}'::jsonb) <> 1 then raise exception '359: trade_doc_fx changed'; end if;
  if car_charge_for_month(date '2026-09-01', date '2026-09-03', 1000) <> 1000 then raise exception '359: first-month full charge changed'; end if;
  if car_charge_for_month(date '2026-09-01', date '2026-09-10', 1000) <> 500  then raise exception '359: first-month half charge changed'; end if;
  if car_charge_for_month(date '2026-09-01', date '2026-09-20', 1000) <> 0    then raise exception '359: first-month nil charge changed'; end if;
  if car_charge_for_month(date '2026-10-01', date '2026-09-20', 1000) <> 1000 then raise exception '359: later-month charge changed'; end if;
  if notif_render('a {x} b', jsonb_build_object('x','Y')) <> 'a Y b' then raise exception '359: notif_render changed'; end if;
  if jsonb_array_length(notification_categories()) <> 7 then raise exception '359: the category list changed'; end if;
end $chk$;

commit;
