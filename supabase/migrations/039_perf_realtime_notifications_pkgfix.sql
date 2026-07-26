-- 039_perf_realtime_notifications_pkgfix.sql
-- (2) Performance indexes, (1) reservation duration, (4) package-update
-- first/last-night fix, (3) realtime publication, (6) notifications backend.

-- ---------------------------------------------------------------------------
-- (2) Indexes on frequently filtered / joined columns
-- ---------------------------------------------------------------------------
create index if not exists idx_umrah_groups_created_at on umrah_groups (created_at desc);
create index if not exists idx_umrah_groups_company on umrah_groups (group_company_id);
create index if not exists idx_umrah_groups_brn_status on umrah_groups (brn_status);
create index if not exists idx_umrah_groups_pkg_status on umrah_groups (package_status);
create index if not exists idx_umrah_groups_agent on umrah_groups (agent_id);
create index if not exists idx_brn_consumption_brn on brn_consumption (brn_id);
create index if not exists idx_brn_consumption_dates on brn_consumption (check_in, check_out);
create index if not exists idx_brn_inventory_company on brn_inventory (group_company_id);
create index if not exists idx_brn_inventory_dates on brn_inventory (check_in, check_out);
create index if not exists idx_group_alloc_group on group_brn_allocation (group_id);

-- ---------------------------------------------------------------------------
-- (1) Reservation duration (1–6 hours). p_hours overrides the default setting.
-- ---------------------------------------------------------------------------
create or replace function create_company_reservation(
  p_company uuid, p_arrival date, p_departure date, p_pax int,
  p_source text default 'admin', p_created_by text default null, p_agent_id uuid default null,
  p_hours int default null)
 returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid; v_min int;
begin
  if p_company is null or p_arrival is null or p_departure is null or p_departure <= p_arrival or coalesce(p_pax,0) <= 0 then
    raise exception 'Invalid reservation.';
  end if;
  if p_hours is not null then
    v_min := least(greatest(p_hours, 1), 6) * 60;                       -- clamp 1..6 hours
  else
    v_min := coalesce(nullif(get_setting('company_reservation_minutes', '20'), '')::int, 20);
  end if;
  insert into company_reservations (group_company_id, arrival_date, departure_date, pax, source, created_by, agent_id, expires_at)
  values (p_company, p_arrival, p_departure, p_pax, coalesce(p_source,'admin'), p_created_by, p_agent_id, now() + make_interval(mins => v_min))
  returning id into v_id;
  return v_id;
end $$;

create or replace function b2b_create_company_reservation(p_token text, p_company uuid, p_arrival date, p_departure date, p_pax int, p_hours int default null)
 returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return create_company_reservation(p_company, p_arrival, p_departure, p_pax, 'agent', a.agency_name, a.id, p_hours);
end $$;

grant execute on function create_company_reservation(uuid, date, date, int, text, text, uuid, int) to authenticated;
grant execute on function b2b_create_company_reservation(text, uuid, date, date, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- (4) Package Update: honour the first/last-night exception. Only request a
-- boundary gap when MORE than the single first/last night is missing.
-- ---------------------------------------------------------------------------
create or replace function can_complete_update(p_group uuid)
 returns boolean language plpgsql stable security definer set search_path to 'public'
as $function$
declare grp umrah_groups%rowtype; okf boolean := true; okb boolean := true; res record;
begin
  select * into grp from umrah_groups where id = p_group;
  if grp.covered_from is null then return false; end if;
  if grp.covered_from > grp.arrival_date + 1 then
    select * into res from plan_window(p_group, grp.arrival_date, grp.covered_from); okf := res.feasible;
  end if;
  if grp.covered_to < grp.departure_date - 1 then
    select * into res from plan_window(p_group, grp.covered_to, grp.departure_date); okb := res.feasible;
  end if;
  return okf and okb;
end $function$;

create or replace function update_package_brns(p_group uuid)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare grp umrah_groups%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform set_config('vista.bypass_guard', '1', true);
  select * into grp from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if grp.brn_status <> 'allocated' then raise exception 'Allocate BRNs first'; end if;
  if grp.package_status not in ('update_required','update_available') then raise exception 'This package does not require an update'; end if;
  -- Only fill a boundary gap that is longer than the tolerated single first/last night.
  if grp.covered_from is not null and grp.covered_from > grp.arrival_date + 1 then perform commit_window(p_group, grp.arrival_date, grp.covered_from); end if;
  if grp.covered_to is not null and grp.covered_to < grp.departure_date - 1 then perform commit_window(p_group, grp.covered_to, grp.departure_date); end if;
  perform recompute_group_coverage(p_group, 'update');
  select * into grp from umrah_groups where id = p_group;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (grp.company_id, auth.uid(), 'package_update_allocated', 'umrah_group', p_group,
          jsonb_build_object('group_no', grp.group_no, 'status', grp.package_status));
  return case when grp.package_status = 'update_ready' then 'ready' else 'partial' end;
end $function$;

-- ---------------------------------------------------------------------------
-- (6) Notifications backend
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null,                 -- 'staff' | 'agent'
  agent_id uuid,                          -- b2b_agents.id when audience = 'agent'
  category text not null default 'system',-- visa | package | brn | reservation | inventory | system
  title text not null,
  body text,
  module text,
  group_id uuid,
  read boolean not null default false,
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_feed on notifications (audience, agent_id, dismissed, created_at desc);
alter table notifications enable row level security;

create or replace function push_notification(
  p_audience text, p_agent_id uuid, p_category text, p_title text, p_body text, p_module text, p_group_id uuid)
 returns void language sql security definer set search_path to 'public'
as $$
  insert into notifications (audience, agent_id, category, title, body, module, group_id)
  values (p_audience, p_agent_id, p_category, p_title, p_body, p_module, p_group_id);
$$;

-- Event trigger: create / status-change notifications for groups.
create or replace function notify_group_events()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_agent uuid;
begin
  select id into v_agent from b2b_agents where agent_party_id = new.agent_id limit 1;
  if tg_op = 'INSERT' then
    perform push_notification('staff', null, 'visa',
      'New Visa Group ' || new.group_no, 'A new visa group was submitted.', 'visa', new.id);
    return new;
  end if;
  -- UPDATE: react to meaningful status transitions
  if new.workflow_status is distinct from old.workflow_status and new.workflow_status = 'brn_allocated' then
    perform push_notification('staff', null, 'brn', 'BRNs allocated · ' || new.group_no, 'Hotel BRNs were allocated for this group.', 'brn', new.id);
    if v_agent is not null then perform push_notification('agent', v_agent, 'brn', 'BRNs allocated · ' || new.group_no, 'Your group has been allocated hotel BRNs.', 'brn', new.id); end if;
  end if;
  if new.package_status is distinct from old.package_status and new.package_status = 'update_required' then
    perform push_notification('staff', null, 'package', 'Package update required · ' || new.group_no, 'This package needs additional BRNs.', 'package', new.id);
  end if;
  if (new.visa_status is distinct from old.visa_status and new.visa_status = 'issued')
     or (new.workflow_status is distinct from old.workflow_status and new.workflow_status = 'visa_issued') then
    if v_agent is not null then perform push_notification('agent', v_agent, 'visa', 'Visa issued · ' || new.group_no, 'The visa has been issued for your group.', 'visa', new.id); end if;
    perform push_notification('staff', null, 'visa', 'Visa issued · ' || new.group_no, 'Visa issued for this group.', 'visa', new.id);
  end if;
  return new;
end $function$;

drop trigger if exists trg_notify_group_events on umrah_groups;
create trigger trg_notify_group_events after insert or update on umrah_groups
  for each row execute function notify_group_events();

-- Staff notification RPCs (authenticated)
create or replace function notifications_feed()
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'category', category, 'title', title, 'body', body, 'module', module,
    'group_id', group_id, 'read', read, 'created_at', created_at
  ) order by created_at desc), '[]'::jsonb)
  from (select * from notifications where audience = 'staff' and not dismissed order by created_at desc limit 100) t;
$$;

create or replace function notifications_mark(p_id uuid, p_action text)
 returns void language plpgsql security definer set search_path to 'public'
as $$ begin
  if p_action = 'read' then update notifications set read = true where id = p_id and audience = 'staff';
  elsif p_action = 'dismiss' then update notifications set dismissed = true where id = p_id and audience = 'staff';
  elsif p_action = 'read_all' then update notifications set read = true where audience = 'staff' and not read;
  end if;
end $$;

-- Agent notification RPCs (token)
create or replace function b2b_notifications_feed(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'category', category, 'title', title, 'body', body, 'module', module,
    'group_id', group_id, 'read', read, 'created_at', created_at
  ) order by created_at desc), '[]'::jsonb)
  from (select * from notifications where audience = 'agent' and agent_id = a.id and not dismissed order by created_at desc limit 100) t);
end $$;

create or replace function b2b_notifications_mark(p_token text, p_id uuid, p_action text)
 returns void language plpgsql security definer set search_path to 'public'
as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  if p_action = 'read' then update notifications set read = true where id = p_id and agent_id = a.id;
  elsif p_action = 'dismiss' then update notifications set dismissed = true where id = p_id and agent_id = a.id;
  elsif p_action = 'read_all' then update notifications set read = true where agent_id = a.id and audience = 'agent' and not read;
  end if;
end $$;

grant execute on function notifications_feed() to authenticated;
grant execute on function notifications_mark(uuid, text) to authenticated;
grant execute on function b2b_notifications_feed(text) to anon, authenticated;
grant execute on function b2b_notifications_mark(text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- (3) Realtime publication for key tables (Supabase Realtime / WebSockets)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['umrah_groups','brn_inventory','brn_consumption','company_reservations','group_brn_allocation','notifications'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; when others then null;
    end;
  end loop;
end $$;
