-- 074_transport_booking_ops_rules
-- Booking, rate, driver-rule, capacity, attachment and deadhead corrections.

-- ---- Schema additions -----------------------------------------------------
alter table public.transport_bookings   add column if not exists nusuk_group_no text;
alter table public.transport_trips       add column if not exists hajj_terminal boolean not null default false;
alter table public.transport_trips       add column if not exists passenger_visa_type text;   -- umrah | visit | other
alter table public.transport_trips       add column if not exists extra_charge numeric not null default 0;
alter table public.transport_drivers     add column if not exists nusuk_registered boolean not null default false;
alter table public.transport_route_rates add column if not exists extra_charge_enabled boolean not null default false;
alter table public.transport_route_rates add column if not exists extra_charge_desc text;
alter table public.transport_route_rates add column if not exists extra_charge_amount numeric not null default 0;

-- ---- Booking attachments (in-DB base64, staff + company scoped) ------------
create table if not exists public.transport_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  booking_id uuid not null references transport_bookings(id) on delete cascade,
  name text not null,
  mime text,
  size int,
  data text not null,
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_transport_attachments_booking on public.transport_attachments (booking_id);
alter table public.transport_attachments enable row level security;
revoke all on public.transport_attachments from anon, authenticated;

create or replace function public.transport_attachment_add(p_booking uuid, p_name text, p_mime text, p_size int, p_data text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v uuid; v_company uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if length(coalesce(p_data,'')) > 9000000 then raise exception 'File too large (max ~6 MB).'; end if;
  if not exists (select 1 from transport_bookings where id = p_booking and company_id = v_company) then raise exception 'Booking not found'; end if;
  insert into transport_attachments(company_id, booking_id, name, mime, size, data, uploaded_by)
  values (v_company, p_booking, p_name, p_mime, p_size, p_data, coalesce((auth.jwt()->>'email'),'staff')) returning id into v;
  return v;
end $$;

create or replace function public.transport_attachment_list(p_booking uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'mime',mime,'size',size,'source','staff','created_at',created_at) order by created_at), '[]'::jsonb)
  from transport_attachments where booking_id = p_booking and company_id = auth_company_id();
$$;

create or replace function public.transport_attachment_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare r transport_attachments%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into r from transport_attachments where id = p_id and company_id = auth_company_id();
  if not found then raise exception 'Not found'; end if;
  return jsonb_build_object('name',r.name,'mime',r.mime,'data',r.data);
end $$;

create or replace function public.transport_attachment_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  delete from transport_attachments where id = p_id and company_id = auth_company_id();
end $$;

-- ---- Route extra charge (e.g. Hajj Terminal) ------------------------------
-- Returns the configured extra-charge amount for a route+vehicle when enabled.
create or replace function public.transport_route_extra(p_company uuid, p_route uuid, p_vehicle uuid)
returns numeric language sql stable set search_path to 'public' as $$
  select coalesce((
    select extra_charge_amount from transport_route_rates
    where company_id = p_company and route_id = p_route and vehicle_id = p_vehicle
      and extra_charge_enabled and coalesce(is_active, true)
    order by created_at desc limit 1
  ), 0);
$$;

-- ---- Deadhead: STRICT directional Route-Master lookup ----------------------
-- The return/repositioning route is directional: previous route destination ->
-- next route origin. We must use THAT route's time, not the reverse leg (which
-- can differ). NULL when the directional route is not defined (unknown).
create or replace function public.transport_deadhead_min(p_company uuid, p_from text, p_to text)
returns int language sql stable set search_path to 'public' as $$
  select case
    when p_from is null or p_to is null then 0
    when lower(btrim(p_from)) = lower(btrim(p_to)) then 0
    else (
      select min(driving_minutes) from transport_routes
      where company_id = p_company and coalesce(is_active, true) and driving_minutes is not null
        and lower(btrim(from_location)) = lower(btrim(p_from))
        and lower(btrim(to_location))   = lower(btrim(p_to))
    )
  end;
$$;

-- ---- Feasibility engine: deadhead + rest/duty + capacity + Nusuk -----------
create or replace function public.transport_driver_reason(p_trip uuid, p_driver uuid)
returns text language plpgsql stable set search_path to 'public' as $$
declare
  cand record; drv record; r record;
  has_prev boolean := false; prev_e timestamp; prev_to text; seg_start timestamp;
  gap_min numeric; need_min int; v_pax int;
begin
  select ts.company_id, ts.booking_id, ts.sched_s, ts.sched_e, ts.passenger_visa_type as visa,
         rt.from_location as r_from, rt.to_location as r_to
    into cand
  from transport_trip_sched ts
  left join transport_routes rt on rt.id = ts.route_id
  where ts.id = p_trip;
  if not found then return 'Trip not found.'; end if;
  if cand.sched_s is null then return 'Set the trip date and time first.'; end if;

  select d.nusuk_registered, d.vehicle_id, v.seating_capacity
    into drv
  from transport_drivers d left join transport_vehicles v on v.id = d.vehicle_id
  where d.id = p_driver;

  -- Vehicle capacity vs passengers on this booking.
  select pax into v_pax from transport_bookings where id = cand.booking_id;
  if drv.seating_capacity is not null and v_pax is not null and drv.seating_capacity < v_pax then
    return format('Vehicle capacity (%s) is less than the passenger count (%s).', drv.seating_capacity, v_pax);
  end if;

  -- Nusuk rule: Umrah-visa airport arrival pickups require a Nusuk-registered driver.
  if lower(coalesce(cand.visa,'')) = 'umrah' and coalesce(cand.r_from,'') ilike '%airport%'
     and not coalesce(drv.nusuk_registered, false) then
    return 'Driver is not Nusuk-registered (required for Umrah-visa airport arrivals).';
  end if;

  for r in
    select s, e, r_from, r_to from (
      select ts.sched_s as s, ts.sched_e as e, rt.from_location as r_from, rt.to_location as r_to
      from transport_trip_sched ts
      left join transport_routes rt on rt.id = ts.route_id
      where ts.driver_id = p_driver and ts.id <> p_trip and ts.status <> 'cancelled'
        and ts.sched_s is not null
        and ts.trip_date between cand.sched_s::date - 1 and cand.sched_s::date + 1
      union all
      select cand.sched_s, cand.sched_e, cand.r_from, cand.r_to
    ) q
    order by s, e
  loop
    if not has_prev then
      seg_start := r.s;
    else
      if r.s < prev_e then return 'Driver already has an overlapping trip at this time.'; end if;
      gap_min := extract(epoch from (r.s - prev_e)) / 60;
      if gap_min >= 600 then
        seg_start := r.s;  -- >=10h idle: mandatory rest satisfied, new duty period
      else
        if prev_to is not null and r.r_from is not null and lower(btrim(prev_to)) <> lower(btrim(r.r_from)) then
          need_min := transport_deadhead_min(cand.company_id, prev_to, r.r_from);
          if need_min is null then
            return format('Repositioning route missing from Route Master (%s → %s). Add this route to enable assignment.', prev_to, r.r_from);
          end if;
          if gap_min < need_min then
            return 'Not enough repositioning (deadhead) travel time between consecutive trips.';
          end if;
        end if;
        if extract(epoch from (r.e - seg_start)) / 3600 > 12 then
          return 'Exceeds the 12-hour maximum working period (a 10-hour continuous rest is required).';
        end if;
      end if;
    end if;
    has_prev := true; prev_e := r.e; prev_to := r.r_to;
  end loop;
  return null;
end $$;

-- Capacity guard for an explicitly chosen vehicle (manual override path).
create or replace function public.transport_vehicle_fits(p_vehicle uuid, p_booking uuid)
returns boolean language sql stable set search_path to 'public' as $$
  select coalesce((select seating_capacity from transport_vehicles where id = p_vehicle), 999)
       >= coalesce((select pax from transport_bookings where id = p_booking), 0);
$$;

-- ---- Assignment entrypoints: fold in capacity for the chosen vehicle -------
create or replace function public.transport_assign_check(p_trip uuid, p_driver uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); c record; v_veh uuid; v_req uuid; v_reason text := null;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select coalesce(ts.requested_vehicle_id, ts.vehicle_id) as req, ts.sched_s as cs, ts.booking_id as bid
    into c from transport_trip_sched ts where ts.id = p_trip and ts.company_id = v_company;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Trip not found.'); end if;
  if c.cs is null then return jsonb_build_object('ok', false, 'reason', 'Set the trip date and time first.'); end if;
  select vehicle_id into v_veh from transport_drivers where id = p_driver;
  v_req := c.req;
  if v_veh is null then v_reason := 'This driver has no vehicle assigned.';
  elsif not transport_vehicle_ok(v_veh, v_req) then v_reason := 'The driver''s vehicle is a lower category than requested (downgrade).';
  elsif not transport_vehicle_fits(v_veh, c.bid) then v_reason := 'The driver''s vehicle cannot seat the passenger count.';
  else v_reason := transport_driver_reason(p_trip, p_driver);
  end if;
  if v_reason is null then return jsonb_build_object('ok', true);
  else return jsonb_build_object('ok', false, 'reason', v_reason); end if;
end $$;

create or replace function public.transport_assign_trip(p_trip uuid, p_driver uuid, p_vehicle uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_reason text DEFAULT NULL::text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); c record; v_veh uuid; v_req uuid; v_conflict text := null;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select coalesce(ts.requested_vehicle_id, ts.vehicle_id) as req, ts.sched_s as cs, ts.sched_e as ce, ts.booking_id as bid
    into c from transport_trip_sched ts where ts.id = p_trip and ts.company_id = v_company;
  if not found then raise exception 'Trip not found'; end if;
  if c.cs is null then raise exception 'Set the trip date and time before assigning a driver.'; end if;
  v_veh := coalesce(p_vehicle, (select vehicle_id from transport_drivers where id = p_driver));
  if v_veh is null then raise exception 'This driver has no vehicle assigned.'; end if;
  v_req := c.req;
  if not transport_vehicle_ok(v_veh, v_req) then v_conflict := 'vehicle downgrade';
  elsif not transport_vehicle_fits(v_veh, c.bid) then v_conflict := 'insufficient seating capacity';
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
end $$;

create or replace function public.transport_auto_assign(p_date date)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_count int := 0; c record; d record; v_driver uuid; v_veh uuid; v_req uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  for c in
    select ts.id, coalesce(ts.requested_vehicle_id, ts.vehicle_id) as req_vehicle, ts.sched_s as cs, ts.sched_e as ce, ts.booking_id as bid
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
        and transport_vehicle_fits(dr.vehicle_id, c.bid)
      order by
        (case when dr.vehicle_id = v_req then 0 else 1 end),
        (select coalesce(upgrade_rank, 999) from transport_vehicles where id = dr.vehicle_id),
        (select coalesce(seating_capacity, 999) from transport_vehicles where id = dr.vehicle_id),
        (select count(*) from transport_trips y where y.driver_id = dr.id and y.trip_date = p_date)
    loop
      if transport_driver_reason(c.id, d.id) is null then v_driver := d.id; v_veh := d.vehicle_id; exit; end if;
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
end $$;
