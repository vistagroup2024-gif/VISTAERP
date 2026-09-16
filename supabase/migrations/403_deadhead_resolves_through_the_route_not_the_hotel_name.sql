-- transport_driver_km() chained deadhead between each trip's own free-text
-- pickup_location/drop_location — a driver's booking form field, typed as a
-- specific hotel ("Millennium Al Aqeeq Hotel"), not a city. loc_city() has no
-- way to resolve a hotel name with no city keyword in it, so it fell back to
-- treating the hotel's first word as a fake city ("Millennium"), which then
-- matched nothing in the Route Master or transport_city_distance() — the gap
-- silently contributed 0 instead of the real distance.
--
-- Every trip is already booked on a transport_routes row, and Route Master
-- names are written in clean "City/Landmark - City/Landmark" form (that is
-- what transport_route_origin/transport_route_dest already parse) — far more
-- reliable than a driver's own hotel spelling. So the gap between two trips
-- is now the PREVIOUS trip's route destination to the NEXT trip's route
-- origin, not their free-text pickup/drop — "route wise", not "hotel wise".
--
-- Verified against Rahat Nazar / STARIA LUXURY (SXA 7141), August 2026: 65
-- trips, same 7,009 km booked either way, but deadhead resolved went from
-- 1,440 km (many gaps silently unresolved) to 2,790 km (62 of 64 gaps
-- resolved) — the free-text version was undercounting real repositioning by
-- close to half.
create or replace function public.transport_driver_km(p_company uuid, p_driver_ids uuid[], p_from date, p_to date)
returns jsonb
language plpgsql stable set search_path to 'public' as $function$
declare v_booked numeric := 0; v_trips int := 0; v_deadhead numeric := 0;
        v_gaps int := 0; v_unresolved int := 0;
begin
  if p_driver_ids is null or coalesce(array_length(p_driver_ids, 1), 0) = 0 then
    return jsonb_build_object('booked_km', 0, 'deadhead_km', 0, 'total_km', 0, 'trips', 0,
      'deadhead_gaps_considered', 0, 'deadhead_gaps_unresolved', 0);
  end if;

  select coalesce(sum(r.distance_km), 0), count(*)
    into v_booked, v_trips
    from transport_trips t join transport_routes r on r.id = t.route_id
   where t.company_id = p_company and t.driver_id = any(p_driver_ids) and t.status = 'completed'
     and not coalesce(t.is_outsourced, false) and t.trip_date between p_from and p_to;

  -- Empty repositioning between one completed trip's route destination and
  -- the next one's route origin, same driver, chronological order (LAG
  -- partitioned by driver so trips of a second matched driver are never
  -- chained onto the first's). The earliest trip in the window has nothing
  -- inside the window to reposition FROM, so it adds nothing — honest about
  -- the edge of what this call can see, not a guess at what came before
  -- p_from.
  select coalesce(sum(transport_deadhead_km(p_company, prev_dest, cur_origin)), 0),
         count(*),
         count(*) filter (where transport_deadhead_km(p_company, prev_dest, cur_origin) is null)
    into v_deadhead, v_gaps, v_unresolved
    from (
      select
        transport_route_origin(r.name, r.from_location, r.to_location) as cur_origin,
        lag(transport_route_dest(r.name, r.from_location, r.to_location))
          over (partition by t.driver_id order by t.trip_date, t.trip_time) as prev_dest
      from transport_trips t
      join transport_routes r on r.id = t.route_id
      where t.company_id = p_company and t.driver_id = any(p_driver_ids) and t.status = 'completed'
        and not coalesce(t.is_outsourced, false) and t.trip_date between p_from and p_to
    ) gaps
   where prev_dest is not null;

  return jsonb_build_object('booked_km', round(v_booked, 1), 'deadhead_km', round(v_deadhead, 1),
    'total_km', round(v_booked + v_deadhead, 1), 'trips', v_trips,
    'deadhead_gaps_considered', v_gaps, 'deadhead_gaps_unresolved', v_unresolved);
end $function$;

revoke all on function public.transport_driver_km(uuid, uuid[], date, date) from public, anon;
grant execute on function public.transport_driver_km(uuid, uuid[], date, date) to authenticated;

do $chk$
declare
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_driver uuid;
  v_result jsonb;
begin
  if not exists (select 1 from profiles where id = v_admin) then
    raise exception 'transport_driver_km self-check: reference admin profile not found';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select id into v_driver from transport_drivers where company_id = v_co and name = 'Rahat Nazar';
  if v_driver is null then
    raise exception 'transport_driver_km self-check: reference driver not found';
  end if;

  select public.transport_driver_km(v_co, array[v_driver], '2026-08-01'::date, '2026-08-31'::date) into v_result;

  -- Booked km must be untouched by this fix — only how the gaps BETWEEN
  -- trips resolve should change.
  if (v_result->>'booked_km')::numeric <> 7009 then
    raise exception 'transport_driver_km self-check: booked_km % changed, expected 7009 (this fix must not touch booked km)',
      v_result->>'booked_km';
  end if;
  -- The route-wise resolution must resolve materially more gaps than the
  -- free-text version did (previously well under half of 64) — that is the
  -- entire point of this migration.
  if (v_result->>'deadhead_gaps_unresolved')::int > 5 then
    raise exception 'transport_driver_km self-check: % gaps still unresolved, expected route-wise resolution to leave very few',
      v_result->>'deadhead_gaps_unresolved';
  end if;
  if (v_result->>'deadhead_km')::numeric <= 1440 then
    raise exception 'transport_driver_km self-check: deadhead_km % did not increase over the old free-text figure of 1440',
      v_result->>'deadhead_km';
  end if;

  raise notice 'transport_driver_km self-check passed: %', v_result;
end;
$chk$;
