-- 071_transport_ops_engine_v3
-- Operations & Driver-Scheduling corrections:
--   1. Deadhead (empty repositioning) travel time between consecutive trips.
--   2. Working-hours policy: 10h continuous rest + max 12h operational window
--      per duty period (a >=10h gap starts a fresh 12h window).
--   3. Preserve valid driver assignments when a booking is edited — only the
--      trips that actually changed are re-evaluated, and only the trip that
--      becomes infeasible is unassigned.

-- ---------------------------------------------------------------------------
-- 1) Deadhead travel time (minutes) between two free-text locations.
--    0 when identical / unknown endpoints; otherwise the driving_minutes of a
--    defined route between the two locations (either direction). Falls back to
--    a small repositioning buffer when no route is defined for the pair.
-- ---------------------------------------------------------------------------
create or replace function public.transport_deadhead_min(p_company uuid, p_from text, p_to text)
returns int
language sql
stable
set search_path to 'public'
as $$
  select case
    when p_from is null or p_to is null then 0
    when lower(btrim(p_from)) = lower(btrim(p_to)) then 0
    else coalesce((
      select min(driving_minutes) from transport_routes
      where company_id = p_company and coalesce(is_active, true)
        and driving_minutes is not null
        and (
          (lower(btrim(from_location)) = lower(btrim(p_from)) and lower(btrim(to_location)) = lower(btrim(p_to)))
          or (lower(btrim(from_location)) = lower(btrim(p_to)) and lower(btrim(to_location)) = lower(btrim(p_from)))
        )
    ), 30)  -- default reposition buffer when the city-pair has no defined route
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Feasibility of assigning a driver to a trip, considering every other
--    trip already on that driver. Returns NULL when OK, else a human reason.
--    Enforces: no overlap, deadhead repositioning between consecutive trips,
--    10h continuous rest (a gap >=10h opens a new duty period) and a maximum
--    12h operational span within any single duty period.
-- ---------------------------------------------------------------------------
create or replace function public.transport_driver_reason(p_trip uuid, p_driver uuid)
returns text
language plpgsql
stable
set search_path to 'public'
as $$
declare
  cand record;
  r record;
  has_prev boolean := false;
  prev_e timestamp;
  prev_drop text;
  seg_start timestamp;
  gap_min numeric;
  need_min int;
begin
  select company_id, sched_s, sched_e, pickup_location, drop_location
    into cand
  from transport_trip_sched where id = p_trip;
  if not found then return 'Trip not found.'; end if;
  if cand.sched_s is null then return 'Set the trip date and time first.'; end if;

  for r in
    select s, e, pickup, drop from (
      -- the driver's other trips (window around the candidate day covers
      -- rest periods that straddle midnight)
      select sched_s as s, sched_e as e, pickup_location as pickup, drop_location as drop
      from transport_trip_sched
      where driver_id = p_driver and id <> p_trip and status <> 'cancelled'
        and sched_s is not null
        and trip_date between cand.sched_s::date - 1 and cand.sched_s::date + 1
      union all
      -- the candidate itself (its row may or may not already carry the driver)
      select cand.sched_s, cand.sched_e, cand.pickup_location, cand.drop_location
    ) q
    order by s, e
  loop
    if not has_prev then
      seg_start := r.s;
    else
      if r.s < prev_e then
        return 'Driver already has an overlapping trip at this time.';
      end if;
      gap_min := extract(epoch from (r.s - prev_e)) / 60;
      if gap_min >= 600 then
        -- >=10h idle -> mandatory rest satisfied, a new duty period begins
        seg_start := r.s;
      else
        need_min := transport_deadhead_min(cand.company_id, prev_drop, r.pickup);
        if gap_min < need_min then
          return 'Not enough repositioning (deadhead) travel time between consecutive trips.';
        end if;
        if extract(epoch from (r.e - seg_start)) / 3600 > 12 then
          return 'Exceeds the 12-hour maximum working period (a 10-hour continuous rest is required).';
        end if;
      end if;
    end if;
    has_prev := true;
    prev_e := r.e;
    prev_drop := r.drop;
  end loop;

  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Rewire the manual-assign check to the new feasibility engine.
-- ---------------------------------------------------------------------------
create or replace function public.transport_assign_check(p_trip uuid, p_driver uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); c record; v_veh uuid; v_req uuid; v_reason text := null;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select coalesce(ts.requested_vehicle_id, ts.vehicle_id) as req, ts.sched_s as cs
    into c from transport_trip_sched ts where ts.id = p_trip and ts.company_id = v_company;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Trip not found.'); end if;
  if c.cs is null then return jsonb_build_object('ok', false, 'reason', 'Set the trip date and time first.'); end if;
  select vehicle_id into v_veh from transport_drivers where id = p_driver;
  v_req := c.req;

  if v_veh is null then
    v_reason := 'This driver has no vehicle assigned.';
  elsif not transport_vehicle_ok(v_veh, v_req) then
    v_reason := 'The driver''s vehicle is a lower category than requested (downgrade).';
  else
    v_reason := transport_driver_reason(p_trip, p_driver);
  end if;

  if v_reason is null then return jsonb_build_object('ok', true);
  else return jsonb_build_object('ok', false, 'reason', v_reason); end if;
end $function$;

-- ---------------------------------------------------------------------------
-- Rewire the assign action to the new feasibility engine (force still overrides).
-- ---------------------------------------------------------------------------
create or replace function public.transport_assign_trip(p_trip uuid, p_driver uuid, p_vehicle uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_reason text DEFAULT NULL::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); c record; v_veh uuid; v_req uuid; v_conflict text := null;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select coalesce(ts.requested_vehicle_id, ts.vehicle_id) as req, ts.sched_s as cs, ts.sched_e as ce
    into c from transport_trip_sched ts where ts.id = p_trip and ts.company_id = v_company;
  if not found then raise exception 'Trip not found'; end if;
  if c.cs is null then raise exception 'Set the trip date and time before assigning a driver.'; end if;
  v_veh := coalesce(p_vehicle, (select vehicle_id from transport_drivers where id = p_driver));
  if v_veh is null then raise exception 'This driver has no vehicle assigned.'; end if;
  v_req := c.req;

  if not transport_vehicle_ok(v_veh, v_req) then v_conflict := 'vehicle downgrade';
  else v_conflict := transport_driver_reason(p_trip, p_driver);
  end if;

  if v_conflict is not null and not p_force then
    raise exception 'Conflict (%). Use Force Assign to override.', v_conflict;
  end if;

  update transport_trips set driver_id = p_driver, vehicle_id = v_veh,
    is_upgraded = (v_veh is distinct from v_req), status = 'assigned',
    scheduled_start = c.cs, scheduled_end = c.ce, assigned_at = now()
  where id = p_trip;

  if p_force and v_conflict is not null then
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (v_company, auth.uid(), 'transport_force_assign', 'transport_trips', p_trip,
      jsonb_build_object('driver', p_driver, 'conflict', v_conflict, 'reason', p_reason, 'at', now()));
  end if;
end $function$;

-- ---------------------------------------------------------------------------
-- Auto-assign: pick the first eligible driver per trip using the new engine.
-- Trips are processed in start-time order so earlier assignments are visible
-- to later feasibility checks within the same run.
-- ---------------------------------------------------------------------------
create or replace function public.transport_auto_assign(p_date date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_count int := 0; c record; d record;
        v_driver uuid; v_veh uuid; v_req uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  for c in
    select ts.id, coalesce(ts.requested_vehicle_id, ts.vehicle_id) as req_vehicle, ts.sched_s as cs, ts.sched_e as ce
    from transport_trip_sched ts join transport_bookings b on b.id = ts.booking_id
    where ts.company_id = v_company and ts.trip_date = p_date
      and ts.driver_id is null and ts.sched_s is not null
      and ts.status in ('pending','outsource_required') and b.status <> 'cancelled'
    order by ts.sched_s
  loop
    v_req := c.req_vehicle; v_driver := null; v_veh := null;
    for d in
      select id, vehicle_id from transport_drivers dr
      where dr.company_id = v_company and dr.status = 'active' and dr.vehicle_id is not null
        and transport_vehicle_ok(dr.vehicle_id, v_req)
      order by
        (case when dr.vehicle_id = v_req then 0 else 1 end),
        (select coalesce(upgrade_rank, 999) from transport_vehicles where id = dr.vehicle_id),
        (select count(*) from transport_trips y where y.driver_id = dr.id and y.trip_date = p_date)
    loop
      if transport_driver_reason(c.id, d.id) is null then
        v_driver := d.id; v_veh := d.vehicle_id; exit;
      end if;
    end loop;

    if v_driver is not null then
      update transport_trips set driver_id = v_driver, vehicle_id = v_veh,
        is_upgraded = (v_veh is distinct from v_req), status = 'assigned',
        scheduled_start = c.cs, scheduled_end = c.ce, assigned_at = now()
      where id = c.id;
      v_count := v_count + 1;
    end if;
  end loop;

  update transport_trips t set status = 'outsource_required'
  from transport_trip_sched ts join transport_bookings b on b.id = ts.booking_id
  where t.id = ts.id and ts.company_id = v_company and ts.trip_date = p_date
    and ts.driver_id is null and ts.status = 'pending' and ts.sched_s is not null and b.status <> 'cancelled';

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'transport_auto_assign', 'transport_trips', null, jsonb_build_object('date', p_date, 'assigned', v_count));
  return v_count;
end $function$;

-- ---------------------------------------------------------------------------
-- 3) Trip sync that PRESERVES valid assignments on booking edit.
--    Matches incoming trips to existing ones by id (preferred) or seq, updates
--    editable fields, and:
--      * leaves an assigned trip untouched when nothing schedule-relevant changed;
--      * re-evaluates the SAME driver when it did change, keeping the assignment
--        if still feasible and unassigning ONLY that trip otherwise;
--      * inserts new trips as pending and deletes removed ones.
--    Unrelated trips in the same booking are never touched.
-- ---------------------------------------------------------------------------
create or replace function public.transport_sync_trips(p_company uuid, p_booking uuid, p_agent uuid, p_pkg_veh uuid, p_bdate date, p_trips jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t jsonb; idx int := 0; v_seq int; v_tveh uuid; v_rate numeric; v_tid uuid;
  ex transport_trips%rowtype; v_keep uuid[] := '{}'; v_changed boolean; v_reason text;
begin
  for t in select * from jsonb_array_elements(coalesce(p_trips, '[]'::jsonb)) loop
    idx := idx + 1;
    v_seq := coalesce(nullif(t->>'seq','')::int, idx);
    v_tveh := coalesce(nullif(t->>'vehicle_id','')::uuid, p_pkg_veh);
    v_rate := coalesce(transport_agent_rate(p_company, p_agent, nullif(t->>'route_id','')::uuid, v_tveh, p_bdate), 0);
    v_tid := nullif(t->>'id','')::uuid;

    ex := null;
    if v_tid is not null then
      select * into ex from transport_trips where id = v_tid and booking_id = p_booking;
    end if;
    if ex.id is null then
      select * into ex from transport_trips where booking_id = p_booking and seq = v_seq order by created_at limit 1;
    end if;

    if ex.id is null then
      -- brand new trip
      insert into transport_trips(company_id, booking_id, seq, route_id, route_label, vehicle_id, requested_vehicle_id,
        trip_date, trip_time, pickup_location, drop_location, flight_no, sell_rate, remarks)
      values (p_company, p_booking, v_seq, nullif(t->>'route_id','')::uuid, t->>'route_label',
        v_tveh, v_tveh, nullif(t->>'trip_date','')::date, nullif(t->>'trip_time','')::time,
        t->>'pickup_location', t->>'drop_location', t->>'flight_no', v_rate, t->>'remarks')
      returning id into v_tid;
      v_keep := array_append(v_keep, v_tid);
    else
      v_keep := array_append(v_keep, ex.id);
      v_changed := (ex.route_id is distinct from nullif(t->>'route_id','')::uuid)
                or (ex.requested_vehicle_id is distinct from v_tveh)
                or (ex.trip_date is distinct from nullif(t->>'trip_date','')::date)
                or (ex.trip_time is distinct from nullif(t->>'trip_time','')::time)
                or (coalesce(ex.pickup_location,'') is distinct from coalesce(t->>'pickup_location',''))
                or (coalesce(ex.drop_location,'') is distinct from coalesce(t->>'drop_location',''));

      -- update editable fields (assigned vehicle stays put while a driver holds it)
      update transport_trips set
        seq = v_seq, route_id = nullif(t->>'route_id','')::uuid, route_label = t->>'route_label',
        requested_vehicle_id = v_tveh,
        vehicle_id = case when ex.driver_id is null then v_tveh else ex.vehicle_id end,
        trip_date = nullif(t->>'trip_date','')::date, trip_time = nullif(t->>'trip_time','')::time,
        pickup_location = t->>'pickup_location', drop_location = t->>'drop_location',
        flight_no = t->>'flight_no', sell_rate = v_rate, remarks = t->>'remarks'
      where id = ex.id;

      if ex.driver_id is not null and v_changed then
        if transport_vehicle_ok(ex.vehicle_id, v_tveh) and transport_driver_reason(ex.id, ex.driver_id) is null then
          -- still feasible with the same driver: refresh schedule + upgrade flag
          update transport_trips ttt set
            scheduled_start = s.sched_s, scheduled_end = s.sched_e,
            is_upgraded = (ex.vehicle_id is distinct from v_tveh),
            status = case when ttt.status in ('pending','outsource_required') then 'assigned' else ttt.status end
          from transport_trip_sched s where s.id = ex.id and ttt.id = ex.id;
        else
          -- only this trip becomes infeasible -> unassign just this trip
          update transport_trips set driver_id = null, vehicle_id = v_tveh, is_upgraded = false,
            status = 'pending', scheduled_start = null, scheduled_end = null, assigned_at = null
          where id = ex.id;
        end if;
      end if;
    end if;
  end loop;

  delete from transport_trips where booking_id = p_booking and not (id = any(v_keep));
end $function$;

-- ---------------------------------------------------------------------------
-- Point both save paths at the preserving sync (replacing delete + re-insert).
-- ---------------------------------------------------------------------------
create or replace function public.transport_save_booking(p_id uuid, p_header jsonb, p_trips jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := p_id; v_company uuid := auth_company_id(); v_no text;
  v_type text := coalesce(p_header->>'booking_type', 'single');
  v_sell numeric := 0; v_total numeric;
  v_pkg uuid := nullif(p_header->>'package_id','')::uuid;
  v_pkg_veh uuid := nullif(p_header->>'package_vehicle_id','')::uuid;
  v_agent uuid := nullif(p_header->>'agent_id','')::uuid;
  v_bdate date := coalesce(nullif(p_header->>'booking_date','')::date, current_date);
  v_adults int := coalesce(nullif(p_header->>'adults','')::int, 0);
  v_children int := coalesce(nullif(p_header->>'children','')::int, 0);
  v_pax int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_pax := nullif(p_header->>'pax','')::int;
  if v_adults + v_children > 0 then v_pax := v_adults + v_children; end if;

  if v_type = 'package' and v_pkg is not null then
    select price into v_sell from transport_package_prices where package_id = v_pkg and vehicle_id = v_pkg_veh and company_id = v_company;
    v_sell := coalesce(v_sell, 0);
  else
    select coalesce(sum(coalesce(transport_agent_rate(v_company, v_agent, nullif(x->>'route_id','')::uuid, nullif(x->>'vehicle_id','')::uuid, v_bdate), 0)), 0)
      into v_sell from jsonb_array_elements(coalesce(p_trips, '[]'::jsonb)) x;
  end if;
  v_total := v_sell;

  if v_id is null then
    v_no := 'TRP-' || lpad(nextval('transport_booking_seq')::text, 6, '0');
    insert into transport_bookings(company_id, booking_no, booking_type, status, agent_id, package_id,
      booking_date, pax, adults, children, passenger_name, mobile, whatsapp, nationality, remarks,
      sell_amount, discount, additional_charges, net_amount, total_amount, currency, created_by)
    values (v_company, v_no, v_type, coalesce(p_header->>'status','draft'), v_agent, v_pkg,
      v_bdate, v_pax, v_adults, v_children, p_header->>'passenger_name', p_header->>'mobile', p_header->>'whatsapp',
      p_header->>'nationality', p_header->>'remarks', v_sell, 0, 0, v_sell, v_total, 'SAR', auth.uid())
    returning id into v_id;
  else
    update transport_bookings set booking_type = v_type, status = coalesce(p_header->>'status', status),
      agent_id = v_agent, package_id = v_pkg, booking_date = v_bdate, pax = v_pax, adults = v_adults, children = v_children,
      passenger_name = p_header->>'passenger_name', mobile = p_header->>'mobile', whatsapp = p_header->>'whatsapp',
      nationality = p_header->>'nationality', remarks = p_header->>'remarks',
      sell_amount = v_sell, discount = 0, additional_charges = 0, net_amount = v_sell, total_amount = v_total, updated_at = now()
    where id = v_id and company_id = v_company;
    if not found then raise exception 'Booking not found'; end if;
  end if;

  perform transport_sync_trips(v_company, v_id, v_agent, v_pkg_veh, v_bdate, p_trips);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when p_id is null then 'transport_booking_created' else 'transport_booking_updated' end,
          'transport_bookings', v_id, jsonb_build_object('total', v_total));
  return v_id;
end $function$;

create or replace function public.b2b_transport_save_booking(p_token text, p_id uuid, p_header jsonb, p_trips jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a b2b_agents%rowtype; v_id uuid := p_id; v_no text;
  v_type text := coalesce(p_header->>'booking_type','single');
  v_sell numeric := 0; v_pkg uuid := nullif(p_header->>'package_id','')::uuid;
  v_pkg_veh uuid := nullif(p_header->>'package_vehicle_id','')::uuid;
  v_bdate date := coalesce(nullif(p_header->>'booking_date','')::date, current_date);
  v_adults int := coalesce(nullif(p_header->>'adults','')::int,0);
  v_children int := coalesce(nullif(p_header->>'children','')::int,0);
  v_pax int; v_status text := coalesce(p_header->>'status','pending'); existing transport_bookings%rowtype;
begin
  a := b2b_agent_of(p_token);
  if v_status not in ('draft','pending','cancelled') then v_status := 'pending'; end if;
  v_pax := nullif(p_header->>'pax','')::int;
  if v_adults + v_children > 0 then v_pax := v_adults + v_children; end if;

  if v_type = 'package' and v_pkg is not null then
    select price into v_sell from transport_package_prices where package_id = v_pkg and vehicle_id = v_pkg_veh and company_id = a.company_id;
    v_sell := coalesce(v_sell,0);
  else
    select coalesce(sum(coalesce(transport_agent_rate(a.company_id, a.id, nullif(x->>'route_id','')::uuid, nullif(x->>'vehicle_id','')::uuid, v_bdate), 0)), 0)
      into v_sell from jsonb_array_elements(coalesce(p_trips,'[]'::jsonb)) x;
  end if;

  if v_id is null then
    v_no := 'TRP-' || lpad(nextval('transport_booking_seq')::text, 6, '0');
    insert into transport_bookings(company_id, booking_no, booking_type, status, agent_id, package_id,
      booking_date, pax, adults, children, passenger_name, mobile, whatsapp, nationality, remarks,
      sell_amount, discount, additional_charges, net_amount, total_amount, currency)
    values (a.company_id, v_no, v_type, v_status, a.id, v_pkg, v_bdate, v_pax, v_adults, v_children,
      p_header->>'passenger_name', p_header->>'mobile', p_header->>'whatsapp', p_header->>'nationality', p_header->>'remarks',
      v_sell, 0, 0, v_sell, v_sell, 'SAR')
    returning id into v_id;
  else
    select * into existing from transport_bookings where id = v_id and company_id = a.company_id and agent_id = a.id;
    if not found then raise exception 'Booking not found'; end if;
    if existing.status not in ('draft','pending') then raise exception 'This booking is locked and can no longer be edited.'; end if;
    update transport_bookings set booking_type = v_type, status = v_status, package_id = v_pkg, booking_date = v_bdate,
      pax = v_pax, adults = v_adults, children = v_children, passenger_name = p_header->>'passenger_name',
      mobile = p_header->>'mobile', whatsapp = p_header->>'whatsapp', nationality = p_header->>'nationality',
      remarks = p_header->>'remarks', sell_amount = v_sell, discount = 0, additional_charges = 0,
      net_amount = v_sell, total_amount = v_sell, updated_at = now()
    where id = v_id;
  end if;

  perform transport_sync_trips(a.company_id, v_id, a.id, v_pkg_veh, v_bdate, p_trips);
  return v_id;
end $function$;
