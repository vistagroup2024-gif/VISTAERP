-- Enforce the ">100 km reposition needs approval" rule on MANUAL assignment too
-- (auto-assign already raises an approval request for long repositions; manual assign
-- only checked vehicle + duty). A long reposition now surfaces as a conflict, so the
-- dispatcher must Force Assign -- which requires a reason and is audit-logged (= approval).

create or replace function public.transport_reposition_conflict(p_trip uuid, p_driver uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $function$
declare v_cs timestamptz; v_orig text; v_dloc text; v_dist numeric;
begin
  select ts.sched_s, loc_city(transport_route_origin(rt.name, rt.from_location, rt.to_location))
    into v_cs, v_orig
  from transport_trip_sched ts left join transport_routes rt on rt.id = ts.route_id
  where ts.id = p_trip;
  if v_cs is null or v_orig is null then return null; end if;
  v_dloc := loc_city(transport_driver_location(p_driver, v_cs));
  if v_dloc is null then return null; end if;
  if lower(btrim(v_dloc)) = lower(btrim(v_orig)) then return null; end if;
  v_dist := transport_city_distance(v_dloc, v_orig);
  if v_dist is null then
    return format('Reposition %s -> %s distance is not in Route Master -- needs approval (Force Assign).', v_dloc, v_orig);
  end if;
  if v_dist > 100 then
    return format('Reposition %s -> %s is %s km (over 100 km) -- needs approval (Force Assign).', v_dloc, v_orig, round(v_dist));
  end if;
  return null;
end $function$;
revoke all on function public.transport_reposition_conflict(uuid, uuid) from anon;

create or replace function public.transport_assign_check(p_trip uuid, p_driver uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
  if v_reason is null then v_reason := transport_reposition_conflict(p_trip, p_driver); end if;
  if v_reason is null then return jsonb_build_object('ok', true);
  else return jsonb_build_object('ok', false, 'reason', v_reason); end if;
end $function$;

create or replace function public.transport_assign_trip(p_trip uuid, p_driver uuid, p_vehicle uuid default null, p_force boolean default false, p_reason text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
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
  if v_conflict is null then v_conflict := transport_reposition_conflict(p_trip, p_driver); end if;
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
