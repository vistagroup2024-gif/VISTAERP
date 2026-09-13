-- Rollback of 373 — Arrival Service in two categories, Driver Tafweej Details.
--
-- Puts back the single-list arrival_compliance (no visa_company column), the
-- five-argument transport_assign_vendor the operations board called before
-- (the two- and four-argument overloads 373 removed were dead code and are not
-- resurrected), the confirmation routine without its "Create Tafweej" send,
-- and drops the tafweej routines and the notification rule.
--
-- THE TWO COLUMNS AND THE SETTING ARE KEPT. transport_drivers.tafweej_reg and
-- transport_trips.outsource_driver_reg hold registrations somebody typed in;
-- dropping a column throws its data away, and a rollback of behaviour is not a
-- reason to lose a plate number. They are inert once nothing reads them. Drop
-- them by hand if that is really wanted.
--
-- Deploy the UI from before 373 alongside this, or the arrivals screen will
-- call a routine that is no longer there.

begin;

drop function if exists public.b2b_trip_tafweej(text, uuid);
drop function if exists public.transport_trip_tafweej(uuid);
drop function if exists public.trip_tafweej_details(uuid, boolean);
drop function if exists public.arrival_transport_by_vista(integer);
drop function if exists public.booking_has_vista_visa(uuid);
delete from notification_rules where rule_key = 'transport.tafweej_agent';

drop function if exists public.arrival_compliance(integer);
create function public.arrival_compliance(p_days integer default 30)
returns table(id uuid, group_no text, group_name text, arrival_date date, pax integer, agency text, arrival_service text, days_to_arrival integer)
language sql stable security definer
set search_path to 'public'
as $function$
  select g.id, g.group_no, g.group_name, g.arrival_date, g.pax,
         coalesce(a.agency_name, p.name) as agency, g.arrival_service,
         (g.arrival_date - current_date) as days_to_arrival
  from umrah_groups g
  left join b2b_agents a on a.agent_party_id = g.agent_id
  left join parties p on p.id = g.agent_id
  where g.company_id = auth_company_id()
    and coalesce(g.workflow_status,'pending') <> 'rejected'
    and g.arrival_date is not null and g.arrival_date >= current_date
    and g.arrival_date <= current_date + p_days
    and arrival_service_state(g.id) = 'pending'
  order by g.arrival_date;
$function$;
revoke all on function public.arrival_compliance(integer) from public, anon;
grant execute on function public.arrival_compliance(integer) to authenticated;

drop function if exists public.transport_assign_vendor(uuid, uuid, text, text, numeric, text);
create function public.transport_assign_vendor(p_trip uuid, p_vendor uuid, p_driver_name text default null, p_driver_mobile text default null, p_vendor_cost numeric default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v transport_vendors%rowtype; t transport_trips%rowtype;
  v_name text; v_mobile text; v_req uuid; v_reqrank int; v_best uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into v from transport_vendors where id = p_vendor and company_id = auth_company_id();
  if not found then raise exception 'Vendor not found'; end if;
  select * into t from transport_trips where id = p_trip and company_id = auth_company_id();
  if not found then raise exception 'Trip not found'; end if;
  v_req := coalesce(t.requested_vehicle_id, t.vehicle_id);
  v_reqrank := coalesce((select upgrade_rank from transport_vehicles where id = v_req), 0);
  if v.vehicle_ids is null or array_length(v.vehicle_ids, 1) is null then v_best := v_req;
  elsif v_req is not null and v_req = any(v.vehicle_ids) then v_best := v_req;
  else
    select ve.id into v_best from transport_vehicles ve
      where ve.id = any(v.vehicle_ids) and coalesce(ve.upgrade_rank, 0) >= v_reqrank
      order by coalesce(ve.upgrade_rank, 0) asc, ve.name limit 1;
    if v_best is null then raise exception 'Vendor % does not operate a vehicle of the required category or higher.', v.name; end if;
  end if;
  if v.vendor_type = 'vendor_driver' then v_name := coalesce(nullif(v.contact_person,''), v.name); v_mobile := v.mobile;
  else v_name := nullif(p_driver_name,''); v_mobile := nullif(p_driver_mobile,''); end if;
  update transport_trips set vendor_id = p_vendor, outsource_driver_name = v_name,
    outsource_driver_mobile = v_mobile, vendor_cost = p_vendor_cost, status = 'assigned', assigned_at = now(),
    driver_id = null, scheduled_start = null, scheduled_end = null,
    requested_vehicle_id = coalesce(requested_vehicle_id, vehicle_id),
    vehicle_id = coalesce(v_best, vehicle_id),
    is_upgraded = (v_best is distinct from v_req)
  where id = p_trip and company_id = auth_company_id()
    and status in ('pending','outsource_required','outsourced','assigned','on_route');
  if not found then raise exception 'Trip not found or cannot be outsourced in its current status.'; end if;
end $function$;
revoke all on function public.transport_assign_vendor(uuid, uuid, text, text, numeric) from public, anon;
grant execute on function public.transport_assign_vendor(uuid, uuid, text, text, numeric) to authenticated;

create or replace function public.transport_confirm_assignments(p_date date)
returns integer
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_n int := 0; r record; v_agent uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  create temp table if not exists _confirmed_bk(booking_id uuid) on commit drop;
  truncate _confirmed_bk;
  with flipped as (
    update transport_trips t set assignment_confirmed = true
    from transport_trip_sched ts join transport_bookings b on b.id = ts.booking_id
    where t.id = ts.id and ts.company_id = v_company and ts.trip_date = p_date
      and b.status <> 'cancelled' and t.assignment_confirmed = false
      and (t.driver_id is not null or t.vendor_id is not null or t.status in ('assigned','outsourced'))
    returning ts.booking_id
  )
  insert into _confirmed_bk select distinct booking_id from flipped;
  get diagnostics v_n = row_count;
  for r in
    select distinct b.agent_id from transport_bookings b
    where b.id in (select booking_id from _confirmed_bk) and b.agent_id is not null
  loop
    select id into v_agent from b2b_agents where agent_party_id = r.agent_id or id = r.agent_id limit 1;
    if v_agent is not null then
      perform push_notification('agent', v_agent, 'transport',
        'Drivers assigned', 'Driver assignments for ' || to_char(p_date,'DD Mon') || ' are confirmed. You can view and copy driver details in your schedule.',
        'transport', null);
    end if;
  end loop;
  return v_n;
end $function$;

do $chk$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname in ('trip_tafweej_details','transport_trip_tafweej','b2b_trip_tafweej','arrival_transport_by_vista','booking_has_vista_visa')) then
    raise exception '373 rollback: a tafweej routine is still there';
  end if;
  if exists (select 1 from notification_rules where rule_key='transport.tafweej_agent') then
    raise exception '373 rollback: the rule is still there';
  end if;
  raise notice '373 rollback ok';
end
$chk$;

commit;
