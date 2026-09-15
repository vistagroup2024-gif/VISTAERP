-- ============================================================
-- 390 — A driver cost is not a fuel receipt someone happened to sign
--
-- Found live, immediately after 389 went in: Starex's Driver line read 0.83
-- SAR/month with no driver expense ever entered. Muhammad Ali drives Starex
-- today, and a 5 SAR fuel expense recorded on the Camry back in July also
-- named him as the driver — so Starex's driver-cost bucket, which summed
-- every transport_expenses row carrying his driver_id regardless of which
-- vehicle it was for, double-counted that fuel receipt: once as the Camry's
-- own fuel cost, again as Starex's "driver" cost, because the same person
-- happened to be tagged on both.
--
-- A driver-cost line is a PERSONAL recurring cost — salary, accommodation,
-- iqama, insurance — the kind entered on the Expenses screen with a Driver
-- chosen and Vehicle left blank. An expense that carries a vehicle_id is a
-- VEHICLE cost, whoever is noted as having incurred it; it belongs to that
-- vehicle's own bucket and nowhere else. So the driver bucket now excludes
-- any row that also carries a vehicle_id.
-- ============================================================
begin;

create or replace function public.transport_vehicle_cost_model(
  p_company uuid, p_vehicle_id uuid, p_from date, p_to date,
  p_overrides jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security invoker set search_path to 'public' as $function$
declare
  v transport_vehicles;
  v_driver_id uuid; v_driver_name text;
  v_months numeric; v_hist_months numeric;
  v_km numeric := 0; v_trips int := 0;
  v_exp record;
  v_drv_exp record;
  v_comp jsonb := '[]'::jsonb;
  v_total_monthly numeric := 0;
  v_cost_per_km numeric := 0;
  v_util_km numeric;
  v_dep_note text;
  v_tyre_cpk numeric; v_tyre_src text;
  v_oil_cpk numeric; v_oil_src text;
  v_fuel_cpk numeric; v_fuel_monthly numeric; v_fuel_src text;
  v_overhead jsonb;
begin
  select * into v from transport_vehicles where id = p_vehicle_id and company_id = p_company;
  if not found then raise exception 'Vehicle not found'; end if;

  v_months := greatest(1, extract(epoch from (p_to::timestamp - p_from::timestamp)) / 86400.0 / 30.4375);

  select id, name into v_driver_id, v_driver_name from transport_drivers
   where vehicle_id = p_vehicle_id and company_id = p_company limit 1;

  select coalesce(sum(r.distance_km), 0), count(*)
    into v_km, v_trips
    from transport_trips t join transport_routes r on r.id = t.route_id
   where t.company_id = p_company and t.vehicle_id = p_vehicle_id and t.status = 'completed'
     and not coalesce(t.is_outsourced, false) and t.trip_date between p_from and p_to;

  select greatest(1, extract(epoch from (p_to::timestamp - min(t.trip_date)::timestamp)) / 86400.0 / 30.4375)
    into v_hist_months
    from transport_trips t
   where t.company_id = p_company and t.vehicle_id = p_vehicle_id and t.status = 'completed'
     and not coalesce(t.is_outsourced, false) and t.trip_date <= p_to;

  v_util_km := coalesce(nullif((p_overrides->>'utilization_km')::numeric, 0), v_km);
  if v_util_km <= 0 then v_util_km := null; end if;

  select
    coalesce(sum(amount) filter (where category = 'fuel'), 0)         as fuel,
    coalesce(sum(amount) filter (where category = 'maintenance'), 0)  as maintenance,
    coalesce(sum(amount) filter (where category = 'tyre'), 0)         as tyre,
    coalesce(sum(amount) filter (where category = 'oil_service'), 0)  as oil_service,
    coalesce(sum(amount) filter (where category = 'insurance'), 0)    as insurance,
    coalesce(sum(amount) filter (where category = 'registration'), 0) as registration,
    coalesce(sum(amount) filter (where category = 'nusuk'), 0)        as nusuk,
    coalesce(sum(amount) filter (where category not in
      ('fuel','maintenance','tyre','oil_service','insurance','registration','nusuk')), 0) as other
    into v_exp
    from transport_expenses
   where company_id = p_company and vehicle_id = p_vehicle_id and spent_on between p_from and p_to;

  -- Driver-only: no vehicle_id. A row that carries BOTH is a vehicle cost
  -- that happens to note who incurred it (a driver filling the tank), not a
  -- personal recurring cost, and it is already counted above.
  select
    coalesce(sum(amount) filter (where category = 'driver_salary'), 0)        as salary,
    coalesce(sum(amount) filter (where category = 'driver_accommodation'), 0) as accommodation,
    coalesce(sum(amount) filter (where category = 'driver_iqama'), 0)         as iqama,
    coalesce(sum(amount) filter (where category = 'driver_insurance'), 0)     as insurance,
    coalesce(sum(amount) filter (where category not in
      ('driver_salary','driver_accommodation','driver_iqama','driver_insurance')), 0) as other
    into v_drv_exp
    from transport_expenses
   where company_id = p_company and driver_id = v_driver_id and vehicle_id is null
     and spent_on between p_from and p_to;

  if p_overrides ? 'fuel_cost_per_km' then
    v_fuel_cpk := (p_overrides->>'fuel_cost_per_km')::numeric; v_fuel_src := 'override';
  elsif v_exp.fuel > 0 and v_km > 0 then
    v_fuel_cpk := round(v_exp.fuel / v_km, 4); v_fuel_src := 'actual';
  else
    v_fuel_cpk := null; v_fuel_src := 'insufficient_data';
  end if;
  v_fuel_monthly := case when v_fuel_cpk is not null and v_util_km is not null then v_fuel_cpk * v_util_km
                         else v_exp.fuel / v_months end;
  v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','fuel','label','Fuel',
    'monthly_cost', round(coalesce(v_fuel_monthly,0),2),
    'cost_per_km', v_fuel_cpk, 'source', v_fuel_src));

  declare v_drv_monthly numeric := v_drv_exp.salary + v_drv_exp.accommodation + v_drv_exp.iqama + v_drv_exp.insurance + v_drv_exp.other;
  begin
    v_drv_monthly := v_drv_monthly / v_months;
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','driver','label','Driver',
      'monthly_cost', round(v_drv_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_drv_monthly / v_util_km, 4) end,
      'source', case when v_drv_monthly > 0 then 'actual' else 'insufficient_data' end,
      'driver_id', v_driver_id, 'driver_name', v_driver_name));
  end;

  if p_overrides ? 'oil_cost_per_km' then
    v_oil_cpk := (p_overrides->>'oil_cost_per_km')::numeric; v_oil_src := 'override';
  elsif v_exp.oil_service > 0 and v_km > 0 then
    v_oil_cpk := round(v_exp.oil_service / v_km, 4); v_oil_src := 'actual';
  elsif coalesce(v.oil_change_cost,0) > 0 and coalesce(v.oil_change_interval_km,0) > 0 then
    v_oil_cpk := round(v.oil_change_cost / v.oil_change_interval_km, 4); v_oil_src := 'lifecycle_model';
  else
    v_oil_cpk := null; v_oil_src := 'insufficient_data';
  end if;
  v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','oil_service','label','Oil / Service',
    'monthly_cost', round(coalesce(v_oil_cpk,0) * coalesce(v_util_km,0), 2),
    'cost_per_km', v_oil_cpk, 'source', v_oil_src));

  if p_overrides ? 'tyre_cost_per_km' then
    v_tyre_cpk := (p_overrides->>'tyre_cost_per_km')::numeric; v_tyre_src := 'override';
  elsif v_exp.tyre > 0 and v_km > 0 then
    v_tyre_cpk := round(v_exp.tyre / v_km, 4); v_tyre_src := 'actual';
  elsif coalesce(v.tyre_cost,0) > 0 and coalesce(v.tyre_life_km,0) > 0 then
    v_tyre_cpk := round(v.tyre_cost / v.tyre_life_km, 4); v_tyre_src := 'lifecycle_model';
  else
    v_tyre_cpk := null; v_tyre_src := 'insufficient_data';
  end if;
  v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','tyres','label','Tyres',
    'monthly_cost', round(coalesce(v_tyre_cpk,0) * coalesce(v_util_km,0), 2),
    'cost_per_km', v_tyre_cpk, 'source', v_tyre_src));

  declare v_maint_monthly numeric := coalesce((p_overrides->>'maintenance_monthly')::numeric, v_exp.maintenance / v_months);
  begin
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','maintenance','label','Maintenance',
      'monthly_cost', round(v_maint_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_maint_monthly / v_util_km, 4) end,
      'source', case when p_overrides ? 'maintenance_monthly' then 'override' when v_exp.maintenance > 0 then 'actual' else 'insufficient_data' end));
  end;

  declare v_ins_reg_monthly numeric := (v_exp.insurance + v_exp.registration) / v_months;
  begin
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','insurance_registration','label','Insurance / Registration',
      'monthly_cost', round(v_ins_reg_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_ins_reg_monthly / v_util_km, 4) end,
      'source', case when v_ins_reg_monthly > 0 then 'actual' else 'insufficient_data' end));
  end;

  declare v_nusuk_monthly numeric := v_exp.nusuk / v_months;
  begin
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','nusuk','label','Nusuk',
      'monthly_cost', round(v_nusuk_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_nusuk_monthly / v_util_km, 4) end,
      'source', case when v_nusuk_monthly > 0 then 'actual' else 'insufficient_data' end));
  end;

  declare v_other_monthly numeric := v_exp.other / v_months;
  begin
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','other','label','Other',
      'monthly_cost', round(v_other_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_other_monthly / v_util_km, 4) end,
      'source', case when v_other_monthly > 0 then 'actual' else 'insufficient_data' end));
  end;

  if coalesce((p_overrides->>'depreciation_enabled')::boolean, v.depreciation_enabled) then
    if coalesce(v.purchase_price,0) > 0 and coalesce(v.expected_life_km,0) > 0 then
      v_dep_note := round((coalesce(v.purchase_price,0) - coalesce(v.expected_resale_value,0)) / v.expected_life_km, 4)::text;
      v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','depreciation','label','Vehicle Depreciation',
        'monthly_cost', round((coalesce(v.purchase_price,0) - coalesce(v.expected_resale_value,0)) / v.expected_life_km * coalesce(v_util_km,0), 2),
        'cost_per_km', round((coalesce(v.purchase_price,0) - coalesce(v.expected_resale_value,0)) / v.expected_life_km, 4),
        'source', 'lifecycle_model_km'));
    elsif coalesce(v.purchase_price,0) > 0 and coalesce(v.expected_life_years,0) > 0 then
      declare v_dep_m numeric := (coalesce(v.purchase_price,0) - coalesce(v.expected_resale_value,0)) / (v.expected_life_years * 12);
      begin
        v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','depreciation','label','Vehicle Depreciation',
          'monthly_cost', round(v_dep_m,2),
          'cost_per_km', case when v_util_km > 0 then round(v_dep_m / v_util_km, 4) end,
          'source', 'lifecycle_model_years'));
      end;
    else
      v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','depreciation','label','Vehicle Depreciation',
        'monthly_cost', 0, 'cost_per_km', null, 'source', 'not_configured'));
    end if;
  else
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','depreciation','label','Vehicle Depreciation',
      'monthly_cost', 0, 'cost_per_km', null, 'source', 'disabled'));
  end if;

  v_overhead := transport_vehicle_overhead_share(p_company, p_vehicle_id, p_from, p_to,
                  p_overrides->>'overhead_method');
  v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','overhead','label','Fleet Overhead',
    'monthly_cost', round((v_overhead->>'vehicle_monthly_share')::numeric, 2),
    'cost_per_km', case when v_util_km > 0 then round((v_overhead->>'vehicle_monthly_share')::numeric / v_util_km, 4) end,
    'source', v_overhead->>'method'));

  select coalesce(sum((c->>'monthly_cost')::numeric),0) into v_total_monthly from jsonb_array_elements(v_comp) c;
  v_cost_per_km := case when v_util_km > 0 then round(v_total_monthly / v_util_km, 4) end;

  return jsonb_build_object(
    'vehicle', jsonb_build_object('id', v.id, 'name', v.name, 'category', v.category,
      'vehicle_type', v.vehicle_type, 'model_year', v.model_year, 'seating_capacity', v.seating_capacity,
      'is_active', v.is_active, 'driver_id', v_driver_id, 'driver_name', v_driver_name, 'ownership', 'owned'),
    'period_months', round(v_months,2),
    'monthly_km', round(v_km,1), 'monthly_km_used', round(coalesce(v_util_km,0),1),
    'utilization_source', case when p_overrides ? 'utilization_km' then 'override' else 'actual' end,
    'trips', v_trips,
    'components', v_comp,
    'monthly_total_cost', round(v_total_monthly,2),
    'cost_per_km', v_cost_per_km,
    'confidence', transport_costing_confidence(v_hist_months, v_trips)
  );
end $function$;
revoke all on function public.transport_vehicle_cost_model(uuid, uuid, date, date, jsonb) from public, anon;
grant execute on function public.transport_vehicle_cost_model(uuid, uuid, date, date, jsonb) to authenticated;

-- ── post-conditions, against the exact live case that exposed this ────────
do $chk$
declare v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
        v_starex uuid; v_camry uuid; v_model jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);
  select id into v_starex from transport_vehicles where company_id = v_co and name = 'Starex';
  select id into v_camry from transport_vehicles where company_id = v_co and name = 'Camry';
  if v_starex is null or v_camry is null then
    raise notice '390: Starex/Camry not found — skipping the live assertion';
  else
    v_model := transport_vehicle_cost_model(v_co, v_starex, (current_date - interval '6 months')::date, current_date, '{}'::jsonb);
    if (select (c->>'monthly_cost')::numeric from jsonb_array_elements(v_model->'components') c where c->>'key' = 'driver') <> 0 then
      raise exception '390: Starex still shows a driver cost with none actually entered for its driver (%)',
        (select c->>'monthly_cost' from jsonb_array_elements(v_model->'components') c where c->>'key' = 'driver');
    end if;
    -- The Camry's own fuel line must still see its 5 SAR — this was never
    -- about hiding the expense, only about not counting it twice.
    v_model := transport_vehicle_cost_model(v_co, v_camry, (current_date - interval '6 months')::date, current_date, '{}'::jsonb);
    if (select (c->>'monthly_cost')::numeric from jsonb_array_elements(v_model->'components') c where c->>'key' = 'fuel') <= 0 then
      raise exception '390: the Camry''s own fuel expense went missing';
    end if;
  end if;
  raise notice '390 ok';
end $chk$;

commit;
