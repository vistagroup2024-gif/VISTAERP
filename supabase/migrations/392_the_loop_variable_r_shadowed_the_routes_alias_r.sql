-- ============================================================
-- 392 — The loop variable r shadowed the routes alias r
--
-- transport_vehicle_cost_model() declared "r record;" for its accounts loop
-- (391's direct-expense breakdown) while ALSO joining transport_routes with
-- the alias r in the monthly-KM query a few lines above. PL/pgSQL binds a
-- bare identifier to a declared variable before it considers it a table
-- alias, so "r.distance_km" there was read as the PL/pgSQL record r (never
-- assigned outside the loop), not the joined route row — the exact shape of
-- trap CLAUDE.md already documents from 387 (car_post_entry's l/l collision):
-- "plpgsql only complains when the statement runs; a create function that
-- succeeds proves nothing."
--
-- 391's own self-check never caught it because it ran against a plate with
-- no driver registered yet, which short-circuits before that query ever
-- runs. Reproduced live for real: a plate WITH a driver matched
-- (STARIA LUXURY / SXA 7141, driven by Rahat Nazar) against a real route
-- threw "record "r" is not assigned yet" at exactly that line.
--
-- Fix: rename the loop variable to acct_row, which cannot collide with any
-- SQL alias used in this function. Self-check now rehearses the ACTUAL
-- driver-matched path this time, not just the empty one.
-- ============================================================
begin;

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
    select coalesce(sum(r.distance_km), 0), count(*)
      into v_km, v_trips
      from transport_trips t join transport_routes r on r.id = t.route_id
     where t.company_id = p_company and t.driver_id = any(v_driver_ids) and t.status = 'completed'
       and not coalesce(t.is_outsourced, false) and t.trip_date between p_from and p_to;

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
    'monthly_km', round(v_km, 1), 'monthly_km_used', round(coalesce(v_util_km, 0), 1),
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

-- ── post-conditions: rehearse the EXACT driver-matched path this time ─────
do $chk$
declare v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
        v_plate uuid; v_route uuid; v_driver uuid; v_model jsonb; v_calc jsonb;
        v_prior_reg text;
begin
  perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);

  select id into v_plate from acct_tag_areas where company_id = v_co and name = 'STARIA LUXURY (SXA 7141)';
  select id into v_route from transport_routes where company_id = v_co and name = 'Jeddah Airport - Makkah';
  if v_plate is null or v_route is null then
    raise notice '392: live plate/route not found — skipping the exact-repro assertion';
  else
    -- This is the exact call the user made from the UI and hit the error on.
    v_calc := transport_costing_calculate(v_co, v_plate, v_route, 'last_6_months', null, null, 'one_way', 'historical', '{}'::jsonb);
    if v_calc->'vehicle'->>'name' <> 'STARIA LUXURY (SXA 7141)' then
      raise exception '392: calculate did not return the expected vehicle';
    end if;
  end if;

  -- Also rehearse with a synthetic driver match, independent of live data,
  -- so this keeps failing loudly even if the live registration is cleared.
  select id into v_driver from transport_drivers where company_id = v_co limit 1;
  if v_driver is not null and v_plate is not null then
    select vista_vehicle_reg into v_prior_reg from transport_drivers where id = v_driver;
    update transport_drivers set vista_vehicle_reg = (select name from acct_tag_areas where id = v_plate) where id = v_driver;
    begin
      v_model := transport_vehicle_cost_model(v_co, v_plate, (current_date - interval '6 months')::date, current_date, '{}'::jsonb);
      if (v_model->'vehicle'->>'driver_matched')::boolean is distinct from true then
        raise exception '392: expected driver_matched = true once a driver carries this plate';
      end if;
    exception when others then
      update transport_drivers set vista_vehicle_reg = v_prior_reg where id = v_driver;
      raise;
    end;
    update transport_drivers set vista_vehicle_reg = v_prior_reg where id = v_driver;
  end if;

  raise notice '392 ok';
end $chk$;

commit;
