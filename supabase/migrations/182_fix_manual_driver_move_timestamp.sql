-- Manual driver repositioning wasn't taking effect. transport_log_driver_movement
-- back-dated a manual move to the last completed trip's completed_at, but
-- transport_driver_location ranks that same trip by its (later) scheduled_end, so the
-- trip's drop city always shadowed the just-logged reposition. Two fixes:
--  1) A manual "move now" (no explicit time) is stamped at now() — strictly after any
--     past trip end — so it wins.
--  2) On an exact timestamp tie, a movement beats a trip (deterministic).

create or replace function public.transport_log_driver_movement(
  p_driver uuid, p_to text, p_from text default null, p_moved_at timestamptz default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_company uuid := auth_company_id(); v_from text; v_id uuid; v_moved timestamptz;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from transport_drivers where id = p_driver and company_id = v_company) then
    raise exception 'Driver not found'; end if;
  -- A manual reposition happens now; only an explicit p_moved_at back-dates it.
  v_moved := coalesce(p_moved_at, now());
  v_from := coalesce(nullif(p_from,''), transport_driver_location(p_driver, v_moved));
  insert into transport_driver_movements(company_id, driver_id, from_location, to_location,
    distance_km, moved_at, reason, created_by)
  values (v_company, p_driver, v_from, p_to,
    transport_city_distance(loc_city(v_from), loc_city(p_to)), v_moved, nullif(p_reason,''), auth.uid())
  returning id into v_id;
  return v_id;
end $function$;

create or replace function public.transport_driver_location(p_driver uuid, p_asof timestamptz default now())
returns text language sql stable set search_path to 'public' as $function$
  with m as (
    select loc_city(to_location) as loc, moved_at as ts, 1 as pri from transport_driver_movements
    where driver_id = p_driver and moved_at <= p_asof order by moved_at desc limit 1
  ), t as (
    select loc_city(split_part(route_label,' - ',2)) as loc,
           coalesce(scheduled_end, (trip_date + trip_time)::timestamptz) as ts, 0 as pri
    from transport_trips
    where driver_id = p_driver and coalesce(scheduled_end, (trip_date + trip_time)::timestamptz) <= p_asof
    order by ts desc limit 1
  )
  select loc from (select loc, ts, pri from m union all select loc, ts, pri from t) z
  where loc is not null order by ts desc, pri desc limit 1;
$function$;
