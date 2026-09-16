-- A Car Parking-type expense is only real on some routes (e.g. an airport
-- transfer), but transport_vehicle_cost_model() blends EVERY posted expense
-- for the vehicle into one cost_per_km, then transport_costing_calculate()
-- multiplies that same blended rate by any route's distance — so pricing
-- Makkah-Madinah (which never incurs that parking fee) still carries a share
-- of it.
--
-- Rather than a persisted route<->account mapping, the calculator gets a
-- per-run deselect: p_overrides.excluded_components names which of THIS
-- call's own component keys (acct_<id>, depreciation, overhead) to leave out
-- of the total, so a user can un-tick Car Parking before pricing a route it
-- doesn't apply to, or un-tick anything to see "how much would cost drop if
-- we cut this" — never a saved setting, asked for fresh on every call, and
-- with nothing excluded the result is byte-for-byte what it was before.
-- transport_costing_calculate() already forwards p_overrides untouched, so
-- this one change reaches the Calculator, Route Compare and Route
-- Profitability alike.
create or replace function public.transport_vehicle_cost_model(p_company uuid, p_tag_area_id uuid, p_from date, p_to date, p_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
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
  v_excluded text[];
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

  -- Which components the caller has deselected for THIS calculation only —
  -- "what would this cost without Car Parking", or a route that never
  -- incurs it. Never a persisted setting: asked for fresh on every call
  -- (a component's own `key`, e.g. acct_<id>, depreciation, overhead), so a
  -- deselection can't go stale and every other caller is unaffected.
  select coalesce(array_agg(x), '{}') into v_excluded
    from jsonb_array_elements_text(coalesce(p_overrides->'excluded_components', '[]'::jsonb)) x;

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
      'source', 'actual',
      'excluded', ('acct_' || acct_row.account_id) = any(v_excluded)));
  end loop;
  if v_direct_monthly = 0 then
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'direct_expenses', 'label', 'Direct Expenses (Chart of Accounts)',
      'monthly_cost', 0, 'cost_per_km', null, 'source', 'insufficient_data', 'excluded', false));
  end if;

  if coalesce((p_overrides->>'depreciation_enabled')::boolean, coalesce(v_profile.depreciation_enabled, true)) then
    if coalesce(v_profile.purchase_price, 0) > 0 and coalesce(v_profile.expected_life_km, 0) > 0 then
      v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'depreciation', 'label', 'Vehicle Depreciation',
        'monthly_cost', round((coalesce(v_profile.purchase_price, 0) - coalesce(v_profile.expected_resale_value, 0)) / v_profile.expected_life_km * coalesce(v_util_km, 0), 2),
        'cost_per_km', round((coalesce(v_profile.purchase_price, 0) - coalesce(v_profile.expected_resale_value, 0)) / v_profile.expected_life_km, 4),
        'source', 'lifecycle_model_km', 'excluded', 'depreciation' = any(v_excluded)));
    elsif coalesce(v_profile.purchase_price, 0) > 0 and coalesce(v_profile.expected_life_years, 0) > 0 then
      declare v_dep_m numeric := (coalesce(v_profile.purchase_price, 0) - coalesce(v_profile.expected_resale_value, 0)) / (v_profile.expected_life_years * 12);
      begin
        v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'depreciation', 'label', 'Vehicle Depreciation',
          'monthly_cost', round(v_dep_m, 2),
          'cost_per_km', case when v_util_km > 0 then round(v_dep_m / v_util_km, 4) end,
          'source', 'lifecycle_model_years', 'excluded', 'depreciation' = any(v_excluded)));
      end;
    else
      v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'depreciation', 'label', 'Vehicle Depreciation',
        'monthly_cost', 0, 'cost_per_km', null, 'source', 'not_configured', 'excluded', false));
    end if;
  else
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'depreciation', 'label', 'Vehicle Depreciation',
      'monthly_cost', 0, 'cost_per_km', null, 'source', 'disabled', 'excluded', false));
  end if;

  v_overhead := transport_vehicle_overhead_share(p_company, p_tag_area_id, p_from, p_to,
                  nullif(p_overrides->>'overhead_method', ''));
  v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'overhead', 'label', 'Fleet Overhead',
    'monthly_cost', round((v_overhead->>'vehicle_monthly_share')::numeric, 2),
    'cost_per_km', case when v_util_km > 0 then round((v_overhead->>'vehicle_monthly_share')::numeric / v_util_km, 4) end,
    'source', v_overhead->>'method', 'excluded', 'overhead' = any(v_excluded)));

  select coalesce(sum((c->>'monthly_cost')::numeric), 0) into v_total_monthly
    from jsonb_array_elements(v_comp) c
   where not coalesce((c->>'excluded')::boolean, false);
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

do $chk$
declare
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_tag uuid := '30de933e-b58c-438e-95f7-8dffe2be3381';
  v_parking_id uuid;
  v_parking_key text;
  v_base jsonb; v_excluded jsonb;
  v_base_total numeric; v_excluded_total numeric; v_parking_cost numeric;
begin
  if not exists (select 1 from profiles where id = v_admin) then
    raise exception 'transport_vehicle_cost_model self-check: reference admin profile not found';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select id into v_parking_id from accounts where company_id = v_co and code = '5-19-41';
  if v_parking_id is null then raise exception 'transport_vehicle_cost_model self-check: reference Car Parking account not found'; end if;
  v_parking_key := 'acct_' || v_parking_id;

  v_base := public.transport_vehicle_cost_model(v_co, v_tag, '2026-08-01'::date, '2026-08-31'::date, '{}'::jsonb);
  v_excluded := public.transport_vehicle_cost_model(v_co, v_tag, '2026-08-01'::date, '2026-08-31'::date,
                  jsonb_build_object('excluded_components', jsonb_build_array(v_parking_key)));

  v_base_total := (v_base->>'monthly_total_cost')::numeric;
  v_excluded_total := (v_excluded->>'monthly_total_cost')::numeric;
  select (c->>'monthly_cost')::numeric into v_parking_cost
    from jsonb_array_elements(v_base->'components') c where c->>'key' = v_parking_key;

  -- Nothing excluded must be byte-for-byte the prior behaviour.
  if v_base_total <> 9988 then
    raise exception 'transport_vehicle_cost_model self-check: baseline total % changed, expected 9988', v_base_total;
  end if;
  -- Excluding Car Parking must drop the total by exactly its own monthly cost.
  if abs((v_base_total - v_excluded_total) - v_parking_cost) > 0.01 then
    raise exception 'transport_vehicle_cost_model self-check: total dropped by % but Car Parking is %',
      v_base_total - v_excluded_total, v_parking_cost;
  end if;

  raise notice 'transport_vehicle_cost_model self-check passed: base_total=%, excluded_total=%, parking_cost=%',
    v_base_total, v_excluded_total, v_parking_cost;
end;
$chk$;
