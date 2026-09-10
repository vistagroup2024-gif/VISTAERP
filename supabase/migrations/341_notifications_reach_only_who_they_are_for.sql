-- A staff notification stops being a broadcast.
--
-- `notifications` has no user_id: a staff row is written once and every staff
-- member reads it. `notifications_feed()` selected `where audience = 'staff'`
-- and `push_dispatch_targets` pushed to `where user_id is not null`, so a visa
-- alert woke the transport clerk's phone and a hotel alert woke everybody's.
-- With 218 of the 234 staff notifications being visa, most people's bell was
-- almost entirely other people's work.
--
-- The row already knows which module it belongs to — `module` is set on every
-- one of the 383 rows, none null — and the module names line up with the
-- permission prefixes the menu already uses. So nothing new has to be recorded
-- when a notification is raised: the filter is a question asked at read time,
-- of the permissions the user already has. That is what makes it work for staff
-- who do not exist yet: give somebody transport.* and they get transport
-- notifications, with nothing here to edit.
--
-- WHO SEES WHAT. `staff_user_sees_module` follows `staff_has_perm` exactly, so
-- there is one convention in the ERP and not two: an admin sees everything, a
-- user with an EMPTY permissions map sees everything (empty means unrestricted,
-- as it does everywhere else), and anyone else needs a ticked key under that
-- module's prefix. `package` maps to visa — a package update is part of the
-- Umrah flow. A module nobody has mapped is shown to EVERYONE rather than
-- hidden from everyone: a new notification kind must not go silently undelivered
-- because this table was not updated.
--
-- READ STATE BECOMES EACH PERSON'S OWN. `read` and `dismissed` are single
-- booleans on the shared row, so Saad marking a transport alert read marked it
-- read for the whole company. That was tolerable while everyone saw the same
-- list and is not once each person has their own. `notification_reads` holds it
-- per user. The legacy columns are LEFT ALONE and still counted as "read by
-- everyone" — without that, 234 notifications already dealt with would spring
-- back unread in every bell the moment this ran.
--
-- The agent side is untouched: it was already scoped by agent_id, in the feed,
-- the mark and the push dispatch alike.

begin;

-- ── per-user read state ────────────────────────────────────────────────────
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references public.profiles(id)      on delete cascade,
  read            boolean not null default false,
  dismissed       boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_reads enable row level security;

drop policy if exists notification_reads_self on public.notification_reads;
-- Wrapped in (select ...) so the helpers are evaluated once per query rather
-- than once per row, the same as every other policy after 312/313.
create policy notification_reads_self on public.notification_reads for all
  using       (user_id = (select auth.uid()) and (select is_staff()))
  with check  (user_id = (select auth.uid()) and (select is_staff()));

grant select, insert, update, delete on public.notification_reads to authenticated;

create index if not exists notification_reads_user_idx
  on public.notification_reads (user_id, notification_id);

-- ── does this user see this module? ────────────────────────────────────────
-- Takes the user explicitly because push dispatch has to ask on behalf of each
-- device owner, not the caller (the caller there is the cron/route, nobody).
create or replace function public.staff_user_sees_module(p_user uuid, p_module text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  with prefix as (
    select case lower(coalesce(p_module, ''))
             when 'visa'      then 'visa'
             when 'package'   then 'visa'      -- a package update is part of the Umrah flow
             when 'transport' then 'transport'
             when 'hotels'    then 'hotels'
             when 'hotel'     then 'hotels'
             when 'brn'       then 'brn'
             else null                          -- unmapped: shown to everyone, see header
           end as p
  ),
  who as (
    select pr.permissions,
           exists (select 1 from user_roles r where r.user_id = p_user and r.role = 'admin') as is_admin
      from profiles pr where pr.id = p_user
  )
  select case
    when (select p from prefix) is null                      then true
    when not exists (select 1 from who)                      then false
    when (select is_admin from who)                          then true
    when coalesce((select permissions from who), '{}'::jsonb) = '{}'::jsonb then true
    else exists (
      select 1 from jsonb_each_text((select permissions from who)) kv
       where kv.key like (select p from prefix) || '.%'
         and kv.value = 'true'
    )
  end;
$$;

revoke all on function public.staff_user_sees_module(uuid, text) from public, anon;
grant execute on function public.staff_user_sees_module(uuid, text) to authenticated;

-- The same question about the caller, for the feed.
create or replace function public.staff_sees_module(p_module text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$ select public.staff_user_sees_module(auth.uid(), p_module); $$;

revoke all on function public.staff_sees_module(text) from public, anon;
grant execute on function public.staff_sees_module(text) to authenticated;

-- ── the bell: this user's modules, this user's read state ──────────────────
create or replace function public.notifications_feed()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'category', category, 'title', title, 'body', body, 'module', module,
    'group_id', group_id, 'link', link, 'read', read, 'created_at', created_at
  ) order by created_at desc), '[]'::jsonb)
  from (
    select n.id, n.category, n.title, n.body, n.module, n.group_id, n.link, n.created_at,
           -- read by me, or read back when the flag was still shared
           (n.read or coalesce(r.read, false)) as read
      from notifications n
      left join notification_reads r
        on r.notification_id = n.id and r.user_id = auth.uid()
     where n.audience = 'staff'
       and not n.dismissed                      -- dismissed for everyone, as before
       and not coalesce(r.dismissed, false)     -- or dismissed by me
       and staff_sees_module(n.module)
     order by n.created_at desc
     limit 100
  ) t;
$$;

-- ── marking: writes my row, never the shared one ───────────────────────────
create or replace function public.notifications_mark(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  if p_action = 'read' then
    insert into notification_reads (notification_id, user_id, read)
      select p_id, v_uid, true
       where exists (select 1 from notifications where id = p_id and audience = 'staff')
    on conflict (notification_id, user_id)
      do update set read = true, updated_at = now();

  elsif p_action = 'dismiss' then
    insert into notification_reads (notification_id, user_id, read, dismissed)
      select p_id, v_uid, true, true
       where exists (select 1 from notifications where id = p_id and audience = 'staff')
    on conflict (notification_id, user_id)
      do update set read = true, dismissed = true, updated_at = now();

  elsif p_action = 'read_all' then
    -- only what this user can actually see; marking read what you cannot read
    -- would hide it the day somebody grants you that module.
    insert into notification_reads (notification_id, user_id, read)
      select n.id, v_uid, true
        from notifications n
       where n.audience = 'staff' and not n.dismissed
         and staff_sees_module(n.module)
    on conflict (notification_id, user_id)
      do update set read = true, updated_at = now();
  end if;
end $$;

-- ── push: each device is asked about its own owner ─────────────────────────
create or replace function public.push_dispatch_targets(p_secret text, p_notification uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare n notifications%rowtype; subs jsonb;
begin
  if p_secret is null or p_secret <> (select dispatch_secret from push_config) then
    raise exception 'Bad dispatch secret';
  end if;
  select * into n from notifications where id = p_notification;
  if not found then return jsonb_build_object('found', false); end if;

  if n.audience = 'agent' then
    -- unchanged: an agent has only ever been sent their own
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::jsonb)
      into subs from push_subscriptions where agent_id = n.agent_id and enabled;
  else
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), '[]'::jsonb)
      into subs
      from push_subscriptions ps
     where ps.user_id is not null and ps.enabled
       and staff_user_sees_module(ps.user_id, n.module);
  end if;

  return jsonb_build_object('found', true,
    'title', n.title, 'body', n.body, 'category', n.category, 'module', n.module,
    'link', coalesce(n.link, case when n.audience='agent' then '/agent' else '/dashboard' end),
    'subs', subs);
end $$;

-- Post-condition: the three routines must be the new ones, and the agent path
-- must still be scoped by agent_id. A half-applied notification filter either
-- silences somebody or shows them somebody else's work.
do $chk$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('staff_user_sees_module','staff_sees_module');
  if n <> 2 then raise exception '341: expected both module helpers, found %', n; end if;

  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
       where ns.nspname='public' and p.proname='notifications_feed') not like '%staff_sees_module%'
  then raise exception '341: notifications_feed is not filtered by module'; end if;

  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
       where ns.nspname='public' and p.proname='push_dispatch_targets') not like '%staff_user_sees_module%'
  then raise exception '341: push_dispatch_targets is not filtered by module'; end if;

  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
       where ns.nspname='public' and p.proname='push_dispatch_targets') not like '%agent_id = n.agent_id%'
  then raise exception '341: the agent push path lost its agent_id scope'; end if;

  if to_regclass('public.notification_reads') is null then
    raise exception '341: notification_reads was not created'; end if;
end $chk$;

commit;
