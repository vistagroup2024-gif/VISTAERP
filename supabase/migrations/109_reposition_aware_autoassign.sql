-- ============================================================
-- VISTA ERP - 109 Reposition-aware auto-assign + approval flow
-- Auto-assign may pull a driver across sectors when the empty reposition is small
-- (<=100km, derived from route distances). A longer reposition is NOT auto-assigned;
-- a transport_reposition_requests row is raised for the dispatcher to Approve
-- (assign + log the move) or Reject (outsource instead). Drivers follow their trips
-- within the run (temp _dloc), so nearby, higher-value work is preferred over a long
-- empty leg, and in-house drivers are used before outsourcing.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================
create table if not exists transport_reposition_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  trip_id uuid not null references transport_trips(id) on delete cascade,
  driver_id uuid not null references transport_drivers(id) on delete cascade,
  from_city text, to_city text, distance_km numeric,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz, resolved_by uuid,
  unique (trip_id)
);

create or replace function public.transport_auto_assign(p_date date)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_company uuid := auth_company_id(); v_count int := 0; c record; d record;
  v_driver uuid; v_veh uuid; v_req uuid;
  v_startcity text; v_dropcity text; v_dcity text; v_repo numeric;
  v_far_drv uuid; v_far_km numeric; v_far_from text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  create temp table if not exists _dloc(driver_id uuid primary key, city text) on commit drop;
  delete from _dloc;
  insert into _dloc(driver_id, city)
  select id, loc_city(transport_driver_location(id, (p_date::timestamp)::timestamptz))
  from transport_drivers where company_id = v_company and status = 'active';

  for c in
    select ts.id, coalesce(ts.requested_vehicle_id, ts.vehicle_id) as req_vehicle,
           ts.sched_s as cs, ts.sched_e as ce, ts.booking_id as bid,
           loc_city(coalesce(ts.pickup_location, split_part(ts.route_name,' - ',1))) as start_city,
           loc_city(coalesce(ts.drop_location,   split_part(ts.route_name,' - ',2))) as drop_city
    from transport_trip_sched ts join transport_bookings b on b.id = ts.booking_id
    where ts.company_id = v_company and ts.trip_date = p_date
      and ts.driver_id is null and ts.sched_s is not null
      and ts.status in ('pending','outsource_required') and b.status <> 'cancelled'
    order by ts.sched_s
  loop
    v_req := c.req_vehicle; v_driver := null; v_veh := null;
    v_startcity := c.start_city; v_dropcity := c.drop_city;
    v_far_drv := null; v_far_km := null; v_far_from := null;

    for d in
      select id, vehicle_id from transport_drivers dr
      where dr.company_id = v_company and dr.status = 'active' and dr.vehicle_id is not null
        and transport_vehicle_ok(dr.vehicle_id, v_req)
        and transport_vehicle_fits(dr.vehicle_id, c.bid)
      order by
        (case when dr.vehicle_id = v_req then 0 else 1 end),
        (select coalesce(upgrade_rank, 999) from transport_vehicles where id = dr.vehicle_id),
        (select coalesce(seating_capacity, 999) from transport_vehicles where id = dr.vehicle_id),
        (select count(*) from transport_trips y where y.driver_id = dr.id and y.trip_date = p_date)
    loop
      if transport_driver_reason(c.id, d.id) is not null then continue; end if;
      v_dcity := (select city from _dloc where driver_id = d.id);
      v_repo := transport_city_distance(v_dcity, v_startcity);
      if v_repo is null or v_repo <= 100 then
        v_driver := d.id; v_veh := d.vehicle_id; exit;
      elsif v_far_drv is null or v_repo < v_far_km then
        v_far_drv := d.id; v_far_km := v_repo; v_far_from := v_dcity;
      end if;
    end loop;

    if v_driver is not null then
      update transport_trips set driver_id = v_driver, vehicle_id = v_veh,
        is_upgraded = (v_veh is distinct from v_req), status = 'assigned',
        scheduled_start = c.cs, scheduled_end = c.ce, assigned_at = now()
      where id = c.id;
      update _dloc set city = coalesce(v_dropcity, city) where driver_id = v_driver;
      delete from transport_reposition_requests where trip_id = c.id and status = 'pending';
      v_count := v_count + 1;
    elsif v_far_drv is not null then
      insert into transport_reposition_requests(company_id, trip_id, driver_id, from_city, to_city, distance_km)
      values (v_company, c.id, v_far_drv, v_far_from, v_startcity, v_far_km)
      on conflict (trip_id) do update set driver_id = excluded.driver_id, from_city = excluded.from_city,
        to_city = excluded.to_city, distance_km = excluded.distance_km, status = 'pending', created_at = now()
      where transport_reposition_requests.status <> 'approved';
    end if;
  end loop;

  update transport_trips t set status = 'outsource_required'
  from transport_trip_sched ts join transport_bookings b on b.id = ts.booking_id
  where t.id = ts.id and ts.company_id = v_company and ts.trip_date = p_date
    and ts.driver_id is null and ts.status = 'pending' and ts.sched_s is not null and b.status <> 'cancelled'
    and not exists (select 1 from transport_reposition_requests rr where rr.trip_id = t.id and rr.status = 'pending');

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'transport_auto_assign', 'transport_trips', null, jsonb_build_object('date', p_date, 'assigned', v_count));
  return v_count;
end $function$;

create or replace function public.transport_approve_reposition(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_company uuid := auth_company_id(); rq transport_reposition_requests%rowtype;
  v_veh uuid; v_req uuid; v_cs timestamptz; v_ce timestamptz;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into rq from transport_reposition_requests where id = p_id and company_id = v_company;
  if not found then raise exception 'Request not found'; end if;
  if rq.status <> 'pending' then raise exception 'Request already resolved'; end if;
  select coalesce(requested_vehicle_id, vehicle_id), sched_s, sched_e into v_req, v_cs, v_ce
    from transport_trip_sched where id = rq.trip_id;
  select vehicle_id into v_veh from transport_drivers where id = rq.driver_id;
  update transport_trips set driver_id = rq.driver_id, vehicle_id = v_veh,
    is_upgraded = (v_veh is distinct from v_req), status = 'assigned',
    scheduled_start = v_cs, scheduled_end = v_ce, assigned_at = now()
  where id = rq.trip_id and company_id = v_company;
  if not found then raise exception 'Trip not found'; end if;
  perform transport_log_driver_movement(rq.driver_id, rq.to_city, rq.from_city, now(), 'Repositioned for trip (approved)');
  update transport_reposition_requests set status = 'approved', resolved_at = now(), resolved_by = auth.uid() where id = p_id;
end $function$;

create or replace function public.transport_reject_reposition(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_company uuid := auth_company_id(); rq transport_reposition_requests%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into rq from transport_reposition_requests where id = p_id and company_id = v_company;
  if not found then raise exception 'Request not found'; end if;
  update transport_reposition_requests set status = 'rejected', resolved_at = now(), resolved_by = auth.uid() where id = p_id;
  update transport_trips set status = 'outsource_required'
  where id = rq.trip_id and company_id = v_company and driver_id is null and status = 'pending';
end $function$;

revoke all on function public.transport_approve_reposition(uuid) from anon, public;
revoke all on function public.transport_reject_reposition(uuid) from anon, public;
