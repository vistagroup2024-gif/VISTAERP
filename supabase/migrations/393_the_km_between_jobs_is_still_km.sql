-- ============================================================
-- 393 — The km between jobs is still km
--
-- transport_vehicle_cost_model()'s monthly_km summed only BOOKED trip
-- distance — every transport_trips row is a real, paid booking
-- (booking_id and sell_rate are both NOT NULL; there is no way to log a
-- pure empty movement as a "trip" anywhere in this ERP). So a driver who
-- drops in Makkah and picks up next from Jeddah Airport really drives that
-- gap, really burns the fuel the Direct Expenses line already counts, but
-- the KM denominator never saw it — understating true km driven and so
-- overstating cost/km relative to what the vehicle actually costs to run
-- per km physically covered.
--
-- transport_deadhead_min() already answers a version of this question for
-- scheduling (does a driver have enough TIME to reposition between two
-- trips), resolving locations to cities via loc_city() and looking the gap
-- up in the Route Master, city pair either direction, falling back to
-- transport_city_distance(). transport_deadhead_km() is the same
-- resolution, answering KM instead of minutes — reusing the office's own
-- already-trusted city lookup rather than inventing a new one.
--
-- WHAT THIS DOES NOT AND CANNOT FIX: pickup_location and drop_location are
-- free text — pickup is almost always a clean "Jeddah Airport"/"Madinah
-- Airport", but drop is usually a specific hotel name ("Hyatt Regency",
-- "VOCO Hotel"), and loc_city()'s keyword match only catches it when the
-- hotel name happens to contain the city word. A gap it cannot resolve to
-- a real city pair contributes 0, not a guess — so this is a conservative
-- estimate that catches genuine city-to-city repositioning (the case asked
-- about: Makkah drop, Jeddah Airport pickup) but understates same-city
-- moves between two named hotels whose text doesn't say which city they
-- are in. transport_driver_km() reports how many gaps it saw and how many
-- of those it could not resolve, so that undercount is visible rather than
-- silently absorbed into the total.
--
-- transport_driver_km() is the one place both callers read from, so
-- "utilization" means the same km whether it is dividing cost (the
-- Calculator's cost/km) or splitting Fleet Overhead by KM — one of the
-- traps this file already warns against (two screens counting a thing two
-- different ways and disagreeing).
--
-- Verified live against the exact reported case before writing this file:
-- Rahat Nazar / STARIA LUXURY (SXA 7141), August 2026 — booked km stayed
-- 7,009 (unchanged), deadhead added 1,440 km (mostly repeated Jeddah
-- Airport <-> Makkah repositioning, correctly resolved through the "Jeddah
-- Airport - Makkah" route already in the Route Master), monthly_km rose to
-- 8,449 and cost/km fell from 1.4250 to 1.1822 — same real cost, spread
-- over the vehicle's real distance instead of only its billable distance.
-- ============================================================
begin;

-- ────────────────────────────────────────────────────────────────────────
-- 1. Deadhead KM — the distance twin of transport_deadhead_min(), which
--    already answers this question in minutes for driver-assignment
--    feasibility (388's Jeddah Airport grace, the repositioning check in
--    transport_driver_reason). Same resolution, same fallbacks, same
--    NULL-means-unresolved convention (never a fabricated distance).
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_deadhead_km(p_company uuid, p_from text, p_to text)
returns numeric language plpgsql stable set search_path to 'public' as $function$
declare a text; b text; v_km numeric;
begin
  if p_from is null or p_to is null then return 0; end if;
  a := loc_city(p_from); b := loc_city(p_to);
  if a is null or b is null then
    if lower(btrim(p_from)) = lower(btrim(p_to)) then return 0; end if;
    select min(distance_km) into v_km from transport_routes
      where company_id = p_company and coalesce(is_active, true) and distance_km is not null
        and lower(btrim(name)) = lower(btrim(p_from) || ' - ' || btrim(p_to));
    return v_km;
  end if;
  if a = b then return 0; end if;

  select min(distance_km) into v_km from transport_routes
    where company_id = p_company and coalesce(is_active, true) and distance_km is not null
      and (
        (loc_city(transport_route_origin(name, from_location, to_location)) = a
         and loc_city(transport_route_dest(name, from_location, to_location)) = b)
        or
        (loc_city(transport_route_origin(name, from_location, to_location)) = b
         and loc_city(transport_route_dest(name, from_location, to_location)) = a)
      );
  if v_km is not null then return v_km; end if;

  return transport_city_distance(a, b);
end $function$;
revoke all on function public.transport_deadhead_km(uuid, text, text) from public, anon;
grant execute on function public.transport_deadhead_km(uuid, text, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 2. transport_driver_km() — booked KM plus estimated deadhead KM for a
--    set of drivers over a period, one routine both the cost model and the
--    overhead allocator call, so "how far did this vehicle actually go"
--    means the same thing in both places.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_driver_km(
  p_company uuid, p_driver_ids uuid[], p_from date, p_to date
) returns jsonb language plpgsql stable set search_path to 'public' as $function$
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

  -- Empty repositioning between one completed trip's drop and the next
  -- one's pickup, same driver, chronological order (LAG partitioned by
  -- driver so trips of a second matched driver are never chained onto the
  -- first's). The earliest trip in the window has nothing inside the
  -- window to reposition FROM, so it adds nothing — honest about the edge
  -- of what this call can see, not a guess at what came before p_from.
  select coalesce(sum(transport_deadhead_km(p_company, prev_drop, pickup_location)), 0),
         count(*),
         count(*) filter (where transport_deadhead_km(p_company, prev_drop, pickup_location) is null)
    into v_deadhead, v_gaps, v_unresolved
    from (
      select pickup_location,
             lag(drop_location) over (partition by driver_id order by trip_date, trip_time) as prev_drop
        from transport_trips
       where company_id = p_company and driver_id = any(p_driver_ids) and status = 'completed'
         and not coalesce(is_outsourced, false) and trip_date between p_from and p_to
    ) gaps
   where prev_drop is not null;

  return jsonb_build_object('booked_km', round(v_booked, 1), 'deadhead_km', round(v_deadhead, 1),
    'total_km', round(v_booked + v_deadhead, 1), 'trips', v_trips,
    'deadhead_gaps_considered', v_gaps, 'deadhead_gaps_unresolved', v_unresolved);
end $function$;
revoke all on function public.transport_driver_km(uuid, uuid[], date, date) from public, anon;
grant execute on function public.transport_driver_km(uuid, uuid[], date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Cost model — booked-only KM sum replaced with transport_driver_km(),
--    monthly_km is now the total (booked + deadhead), and the split is
--    exposed so the UI can show it rather than silently blend it in.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_vehicle_cost_model(
  p_company uuid, p_tag_area_id uuid, p_from date, p_to date,
  p_overrides jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security invoker set search_path to 'public' as $function$
declare
  v_tag_name text;
  v_profile transport_vehicle_profiles;
  v_driver_ids uuid[]; v_driver_name text; v_any_driver_match boolean;
  v_months numeric; v_hist_months numeric;
  v_km numeric := 0; v_trips int := 0;
  v_kmj jsonb; v_booked_km numeric := 0; v_deadhead_km numeric := 0;
  v_comp jsonb := '[]'::jsonb;
  v_direct_monthly numeric := 0;
  v_total_monthly numeric := 0;
  v_cost_per_km numeric := 0;
  v_util_km numeric;
  v_overhead jsonb;
  acct_row record;
begin
  select ta.name into v_tag_name
    from acct_tag_areas ta join acct_tag_areas grp on grp.id = ta.parent_id
   where ta.id = p_tag_area_id and ta.company_id = p_company and ta.is_group = false and grp.name = 'VISTA TRANSPORT';
  if v_tag_name is null then raise exception 'Vehicle not found (not a VISTA TRANSPORT plate)'; end if;

  select * into v_profile from transport_vehicle_profiles where tag_area_id = p_tag_area_id;

  v_months := greatest(1, extract(epoch from (p_to::timestamp - p_from::timestamp)) / 86400.0 / 30.4375);

  select array_agg(id), string_agg(name, ', ') into v_driver_ids, v_driver_name
    from transport_drivers where company_id = p_company and vista_vehicle_reg = v_tag_name;
  v_any_driver_match := coalesce(array_length(v_driver_ids, 1), 0) > 0;

  if v_any_driver_match then
    v_kmj := transport_driver_km(p_company, v_driver_ids, p_from, p_to);
    v_booked_km := coalesce((v_kmj->>'booked_km')::numeric, 0);
    v_deadhead_km := coalesce((v_kmj->>'deadhead_km')::numeric, 0);
    v_km := v_booked_km + v_deadhead_km;
    v_trips := coalesce((v_kmj->>'trips')::int, 0);

    select greatest(1, extract(epoch from (p_to::timestamp - min(t.trip_date)::timestamp)) / 86400.0 / 30.4375)
      into v_hist_months
      from transport_trips t
     where t.company_id = p_company and t.driver_id = any(v_driver_ids) and t.status = 'completed'
       and not coalesce(t.is_outsourced, false) and t.trip_date <= p_to;
  end if;

  v_util_km := coalesce(nullif((p_overrides->>'utilization_km')::numeric, 0), v_km);
  if v_util_km <= 0 then v_util_km := null; end if;

  for acct_row in
    select a.id as account_id, a.code, a.name, sum(jl.debit - jl.credit) as amt
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join accounts a on a.id = jl.account_id
     where je.company_id = p_company and je.status = 'posted' and a.type = 'expense'
       and jl.tag_area = v_tag_name and je.entry_date between p_from and p_to
     group by a.id, a.code, a.name
    having sum(jl.debit - jl.credit) <> 0
     order by a.code
  loop
    v_direct_monthly := v_direct_monthly + (acct_row.amt / v_months);
    v_comp := v_comp || jsonb_build_array(jsonb_build_object(
      'key', 'acct_' || acct_row.account_id, 'label', acct_row.name, 'account_code', acct_row.code,
      'monthly_cost', round(acct_row.amt / v_months, 2),
      'cost_per_km', case when v_util_km > 0 then round((acct_row.amt / v_months) / v_util_km, 4) end,
      'source', 'actual'));
  end loop;
  if v_direct_monthly = 0 then
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'direct_expenses', 'label', 'Direct Expenses (Chart of Accounts)',
      'monthly_cost', 0, 'cost_per_km', null, 'source', 'insufficient_data'));
  end if;

  if coalesce((p_overrides->>'depreciation_enabled')::boolean, coalesce(v_profile.depreciation_enabled, true)) then
    if coalesce(v_profile.purchase_price, 0) > 0 and coalesce(v_profile.expected_life_km, 0) > 0 then
      v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'depreciation', 'label', 'Vehicle Depreciation',
        'monthly_cost', round((coalesce(v_profile.purchase_price, 0) - coalesce(v_profile.expected_resale_value, 0)) / v_profile.expected_life_km * coalesce(v_util_km, 0), 2),
        'cost_per_km', round((coalesce(v_profile.purchase_price, 0) - coalesce(v_profile.expected_resale_value, 0)) / v_profile.expected_life_km, 4),
        'source', 'lifecycle_model_km'));
    elsif coalesce(v_profile.purchase_price, 0) > 0 and coalesce(v_profile.expected_life_years, 0) > 0 then
      declare v_dep_m numeric := (coalesce(v_profile.purchase_price, 0) - coalesce(v_profile.expected_resale_value, 0)) / (v_profile.expected_life_years * 12);
      begin
        v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'depreciation', 'label', 'Vehicle Depreciation',
          'monthly_cost', round(v_dep_m, 2),
          'cost_per_km', case when v_util_km > 0 then round(v_dep_m / v_util_km, 4) end,
          'source', 'lifecycle_model_years'));
      end;
    else
      v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'depreciation', 'label', 'Vehicle Depreciation',
        'monthly_cost', 0, 'cost_per_km', null, 'source', 'not_configured'));
    end if;
  else
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'depreciation', 'label', 'Vehicle Depreciation',
      'monthly_cost', 0, 'cost_per_km', null, 'source', 'disabled'));
  end if;

  v_overhead := transport_vehicle_overhead_share(p_company, p_tag_area_id, p_from, p_to,
                  nullif(p_overrides->>'overhead_method', ''));
  v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'overhead', 'label', 'Fleet Overhead',
    'monthly_cost', round((v_overhead->>'vehicle_monthly_share')::numeric, 2),
    'cost_per_km', case when v_util_km > 0 then round((v_overhead->>'vehicle_monthly_share')::numeric / v_util_km, 4) end,
    'source', v_overhead->>'method'));

  select coalesce(sum((c->>'monthly_cost')::numeric), 0) into v_total_monthly from jsonb_array_elements(v_comp) c;
  v_cost_per_km := case when v_util_km > 0 then round(v_total_monthly / v_util_km, 4) end;

  return jsonb_build_object(
    'vehicle', jsonb_build_object('id', p_tag_area_id, 'name', v_tag_name, 'plate', v_tag_name,
      'model_year', v_profile.model_year,
      'driver_id', case when array_length(v_driver_ids, 1) = 1 then v_driver_ids[1] end,
      'driver_name', v_driver_name, 'driver_matched', v_any_driver_match, 'ownership', 'owned'),
    'period_months', round(v_months, 2),
    'monthly_km', round(v_km, 1), 'monthly_km_booked', round(v_booked_km, 1), 'monthly_km_deadhead_estimated', round(v_deadhead_km, 1),
    'monthly_km_used', round(coalesce(v_util_km, 0), 1),
    'utilization_source', case when p_overrides ? 'utilization_km' then 'override' else 'actual' end,
    'trips', v_trips,
    'components', v_comp,
    'monthly_total_cost', round(v_total_monthly, 2),
    'cost_per_km', v_cost_per_km,
    'confidence', transport_costing_confidence(v_hist_months, v_trips),
    'vehicle_match_source', case when v_any_driver_match then 'driver_registration_current' else 'no_driver_registered' end
  );
end $function$;
revoke all on function public.transport_vehicle_cost_model(uuid, uuid, date, date, jsonb) from public, anon;
grant execute on function public.transport_vehicle_cost_model(uuid, uuid, date, date, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Fleet overhead's by_km/by_utilization method — same
--    transport_driver_km(), so it measures a vehicle's utilization the
--    same way the cost model now does.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_vehicle_overhead_share(
  p_company uuid, p_tag_area_id uuid, p_from date, p_to date, p_method text default null
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare
  v_method text := coalesce(p_method, get_setting('transport_costing_overhead_method', 'equal'));
  v_total numeric; v_active_n int; v_share numeric := 0; v_months numeric;
  v_veh_km numeric; v_fleet_km numeric;
  v_veh_driver_ids uuid[]; v_fleet_driver_ids uuid[];
  v_veh_rev numeric; v_fleet_rev numeric;
  v_veh_days int; v_fleet_days int;
  v_manual numeric;
  v_group_id uuid; v_tag_name text;
begin
  select id into v_group_id from acct_tag_areas where company_id = p_company and name = 'VISTA TRANSPORT' and is_group = true;
  select name into v_tag_name from acct_tag_areas where id = p_tag_area_id;

  v_months := greatest(1, extract(epoch from (p_to::timestamp - p_from::timestamp)) / 86400.0 / 30.4375);

  select coalesce(sum(amount), 0) into v_total
    from transport_expenses
   where company_id = p_company and vehicle_id is null and driver_id is null
     and category = 'admin_overhead' and spent_on between p_from and p_to;
  v_total := v_total / v_months;

  select count(*) into v_active_n from acct_tag_areas
   where company_id = p_company and parent_id = v_group_id and is_group = false and is_active;

  if v_method = 'manual' then
    select overhead_manual_monthly into v_manual from transport_vehicle_profiles where tag_area_id = p_tag_area_id;
    return jsonb_build_object('method', 'manual', 'vehicle_monthly_share', coalesce(v_manual, 0),
      'fleet_monthly_total', v_total, 'active_vehicles', v_active_n);
  end if;

  if v_active_n = 0 or v_total = 0 then
    return jsonb_build_object('method', v_method, 'vehicle_monthly_share', 0,
      'fleet_monthly_total', v_total, 'active_vehicles', v_active_n);
  end if;

  if v_method in ('by_km', 'by_utilization') then
    select array_agg(id) into v_veh_driver_ids from transport_drivers where company_id = p_company and vista_vehicle_reg = v_tag_name;
    v_veh_km := coalesce((transport_driver_km(p_company, v_veh_driver_ids, p_from, p_to)->>'total_km')::numeric, 0);

    select array_agg(d.id) into v_fleet_driver_ids
      from transport_drivers d join acct_tag_areas ta on ta.name = d.vista_vehicle_reg and ta.parent_id = v_group_id
     where d.company_id = p_company;
    v_fleet_km := coalesce((transport_driver_km(p_company, v_fleet_driver_ids, p_from, p_to)->>'total_km')::numeric, 0);

    v_share := case when v_fleet_km > 0 then v_total * (v_veh_km / v_fleet_km) else v_total / v_active_n end;
    v_method := 'by_km';
  elsif v_method = 'by_revenue' then
    select coalesce(sum(t.sell_rate), 0) into v_veh_rev
      from transport_trips t where t.company_id = p_company and t.status = 'completed' and not coalesce(t.is_outsourced, false)
        and t.trip_date between p_from and p_to
        and t.driver_id in (select id from transport_drivers where company_id = p_company and vista_vehicle_reg = v_tag_name);
    select coalesce(sum(t.sell_rate), 0) into v_fleet_rev
      from transport_trips t
      join transport_drivers d on d.id = t.driver_id
      join acct_tag_areas ta on ta.name = d.vista_vehicle_reg and ta.parent_id = v_group_id
     where t.company_id = p_company and t.status = 'completed' and not coalesce(t.is_outsourced, false)
       and t.trip_date between p_from and p_to;
    v_share := case when v_fleet_rev > 0 then v_total * (v_veh_rev / v_fleet_rev) else v_total / v_active_n end;
  elsif v_method = 'by_active_days' then
    select count(distinct t.trip_date) into v_veh_days
      from transport_trips t where t.company_id = p_company and t.status = 'completed' and not coalesce(t.is_outsourced, false)
        and t.trip_date between p_from and p_to
        and t.driver_id in (select id from transport_drivers where company_id = p_company and vista_vehicle_reg = v_tag_name);
    select count(distinct (ta.id, t.trip_date)) into v_fleet_days
      from transport_trips t
      join transport_drivers d on d.id = t.driver_id
      join acct_tag_areas ta on ta.name = d.vista_vehicle_reg and ta.parent_id = v_group_id
     where t.company_id = p_company and t.status = 'completed' and not coalesce(t.is_outsourced, false)
       and t.trip_date between p_from and p_to;
    v_share := case when v_fleet_days > 0 then v_total * (v_veh_days::numeric / v_fleet_days) else v_total / v_active_n end;
  else
    v_share := v_total / v_active_n;
    v_method := 'equal';
  end if;

  return jsonb_build_object('method', v_method, 'vehicle_monthly_share', round(v_share, 2),
    'fleet_monthly_total', round(v_total, 2), 'active_vehicles', v_active_n);
end $function$;
revoke all on function public.transport_vehicle_overhead_share(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.transport_vehicle_overhead_share(uuid, uuid, date, date, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 5. The Calculator — thread the booked/deadhead split through so the UI
--    can show it, instead of only leaving it inside transport_vehicle_cost_model's
--    own return value where the Calculator never looks.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_calculate(
  p_company uuid, p_tag_area_id uuid, p_route_id uuid,
  p_period text, p_period_from date, p_period_to date,
  p_trip_type text default 'one_way', p_return_condition text default 'historical',
  p_overrides jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_from date; v_to date; v_route transport_routes; v_model jsonb; v_km jsonb;
        v_manual_empty numeric; v_hist jsonb; v_pricing jsonb; v_sales jsonb; v_warnings jsonb := '[]'::jsonb;
begin
  select period_from, period_to into v_from, v_to from transport_costing_period_bounds(p_period, p_period_from, p_period_to);
  select * into v_route from transport_routes where id = p_route_id and company_id = p_company;
  if not found then raise exception 'Route not found'; end if;

  v_model := transport_vehicle_cost_model(p_company, p_tag_area_id, v_from, v_to, p_overrides);
  v_hist := transport_route_return_probability(p_company, p_route_id, v_from, v_to);
  v_manual_empty := nullif(p_overrides->>'return_pct_override', '')::numeric;
  v_km := transport_costing_expected_km(coalesce(v_route.distance_km, 0), p_trip_type, p_return_condition,
            nullif(v_hist->>'historical_empty_return_pct', '')::numeric, v_manual_empty);

  declare v_trip_cost numeric := round(coalesce((v_model->>'cost_per_km')::numeric, 0) * (v_km->>'total_km')::numeric, 2);
  begin
    v_pricing := transport_costing_pricing(v_trip_cost);
    v_sales := transport_costing_sales_history(p_company, p_tag_area_id, p_route_id, v_from, v_to, (v_model->>'cost_per_km')::numeric);

    if (v_model->'confidence'->>'level') = 'low' then
      v_warnings := v_warnings || jsonb_build_array('LIMITED DATA — this estimate is based on limited historical records.');
    end if;
    if (v_model->>'monthly_km')::numeric > 0 and (v_model->>'monthly_km')::numeric < 500 then
      v_warnings := v_warnings || jsonb_build_array('LOW UTILIZATION — fixed monthly costs are being spread over very few KM, inflating cost/KM.');
    end if;
    if not coalesce((v_model->'vehicle'->>'driver_matched')::boolean, false) then
      v_warnings := v_warnings || jsonb_build_array('NO DRIVER REGISTERED — no driver in Transport → Drivers has this plate set as their Registration No, so trip KM/revenue cannot be attributed to it yet. Direct expenses (from posted vouchers) are still shown.');
    end if;

    return jsonb_build_object(
      'vehicle', v_model->'vehicle', 'route', jsonb_build_object('id', v_route.id, 'name', v_route.name,
        'from_location', v_route.from_location, 'to_location', v_route.to_location, 'distance_km', v_route.distance_km),
      'period', jsonb_build_object('label', p_period, 'from', v_from, 'to', v_to),
      'trip_type', p_trip_type, 'return_condition', p_return_condition, 'return_probability', v_hist,
      'km', v_km, 'components', v_model->'components',
      'monthly_total_cost', v_model->'monthly_total_cost', 'cost_per_km', v_model->'cost_per_km',
      'monthly_km', v_model->'monthly_km', 'monthly_km_booked', v_model->'monthly_km_booked',
      'monthly_km_deadhead_estimated', v_model->'monthly_km_deadhead_estimated',
      'trip_cost', v_trip_cost, 'pricing', v_pricing, 'historical_sales', v_sales,
      'confidence', v_model->'confidence', 'warnings', v_warnings, 'overrides_applied', p_overrides);
  end;
end $function$;
revoke all on function public.transport_costing_calculate(uuid, uuid, uuid, text, date, date, text, text, jsonb) from public, anon;
grant execute on function public.transport_costing_calculate(uuid, uuid, uuid, text, date, date, text, text, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 6. Self-verifying checks — against the exact reported case, per the
--    lesson 392 just wrote into CLAUDE.md: rehearse the branch that
--    matters (a real driver with real gaps), not the trivial one.
-- ────────────────────────────────────────────────────────────────────────
do $chk$
declare v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
        v_plate uuid; v_route uuid; v_driver uuid;
        v_model_after jsonb; v_calc jsonb;
        v_dh numeric;
begin
  perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);

  -- Same city: no deadhead.
  if transport_deadhead_km(v_co, 'Makkah Hotel', 'Makkah Towers') <> 0 then
    raise exception '393: same-city gap should be 0 km';
  end if;
  -- A real, resolvable city pair must match the Route Master's own distance.
  if transport_deadhead_km(v_co, 'Makkah Hotel', 'Jeddah Airport') <> 90 then
    raise exception '393: Makkah/Jeddah deadhead should resolve to the Route Master''s 90 km, got %',
      transport_deadhead_km(v_co, 'Makkah Hotel', 'Jeddah Airport');
  end if;
  -- Free-text hotel names with no recognizable city must not fabricate a distance.
  if transport_deadhead_km(v_co, 'Hyatt Regency', 'Some Random Guesthouse') is not null then
    raise exception '393: an unresolvable pair must return null, not a guessed distance';
  end if;

  select id into v_plate from acct_tag_areas where company_id = v_co and name = 'STARIA LUXURY (SXA 7141)';
  select id into v_driver from transport_drivers where company_id = v_co and name = 'Rahat Nazar';
  if v_plate is null or v_driver is null then
    raise notice '393: live plate/driver not found — skipping the exact-repro assertion';
  else
    -- August: this driver's booked km must still be exactly 7009 (unchanged
    -- from before this migration), and deadhead must now add a real amount
    -- on top of it, not zero — otherwise this migration did nothing.
    select (transport_driver_km(v_co, array[v_driver], '2026-08-01', '2026-08-31')->>'booked_km')::numeric into v_dh;
    if v_dh <> 7009 then raise exception '393: August booked km changed from the known value, got %', v_dh; end if;

    select (transport_driver_km(v_co, array[v_driver], '2026-08-01', '2026-08-31')->>'deadhead_km')::numeric into v_dh;
    if v_dh is null or v_dh <= 0 then
      raise exception '393: expected a positive deadhead estimate for a driver who repeatedly shuttles Jeddah Airport <-> Makkah, got %', v_dh;
    end if;

    v_model_after := transport_vehicle_cost_model(v_co, v_plate, '2026-08-01'::date, '2026-08-31'::date, '{}'::jsonb);
    if (v_model_after->>'monthly_km')::numeric <= 7009 then
      raise exception '393: monthly_km should now exceed the booked-only 7009, got %', v_model_after->>'monthly_km';
    end if;
    if (v_model_after->>'monthly_km_booked')::numeric <> 7009 then
      raise exception '393: monthly_km_booked should still read 7009';
    end if;
    if (v_model_after->>'cost_per_km')::numeric >= 1.425 then
      raise exception '393: cost_per_km should have fallen below the old 1.4250 (same cost, more km), got %', v_model_after->>'cost_per_km';
    end if;

    -- The exact Calculator run reported: Previous month, Madinah - Makkah, paid return.
    select id into v_route from transport_routes where company_id = v_co and name = 'Madinah - Makkah';
    if v_route is not null then
      v_calc := transport_costing_calculate(v_co, v_plate, v_route, 'previous_month', null, null, 'one_way', 'paid', '{}'::jsonb);
      if v_calc->>'trip_cost' = '641.25' then
        raise exception '393: trip_cost is still the old pre-deadhead figure — the fix did not take effect on the live call path';
      end if;
      if v_calc->'monthly_km_deadhead_estimated' is null then
        raise exception '393: transport_costing_calculate did not forward the deadhead breakdown';
      end if;
    end if;
  end if;

  -- The overhead allocator's by_km path must still run without error against
  -- the same live data (it is now driven by transport_driver_km() too).
  if v_plate is not null then
    perform transport_vehicle_overhead_share(v_co, v_plate, '2026-08-01'::date, '2026-08-31'::date, 'by_km');
  end if;

  raise notice '393 ok';
end $chk$;

commit;
