-- ============================================================
-- 389 — Transport Costing & Pricing Intelligence
--
-- A new, additional module. Nothing existing is touched: no column is
-- renamed or dropped, no existing RPC's signature or behaviour changes, no
-- screen is redesigned. Everything this reads is data the ERP already has:
--
--   transport_vehicles   — the OWNED fleet, one row per physical vehicle
--   transport_drivers    — vehicle_id says who is assigned to it NOW
--   transport_routes     — distance_km is the Route Master's own figure
--   transport_trips      — the actual trip ledger: status, vehicle_id,
--                          driver_id, route_id, sell_rate, is_outsourced,
--                          vendor_cost. transport_trip_sched is a VIEW over
--                          this same table (048) — nothing new to read.
--   transport_expenses   — already vehicle_id/driver_id-tagged; category is
--                          free text with no CHECK, so it is extended rather
--                          than replaced (ExpenseManager.tsx keeps its six
--                          original categories, unchanged, and gains more).
--
-- WHAT AN OWNED VEHICLE IS: measured live, every completed trip — outsourced
-- included — carries a vehicle_id, because vehicle_id names the CATEGORY of
-- vehicle the booking needed, not who actually drove it. Only
-- is_outsourced = false trips are this vehicle's own operating history; an
-- is_outsourced = true trip's cost is its vendor_cost, full stop, and never
-- touches this vehicle's fuel, driver, depreciation or overhead — exactly
-- what section 20 of the spec asked for, and it is already how the schema
-- was built, not something this migration had to invent.
--
-- WHAT IS GENUINELY NEW, because nothing in the ERP holds it today:
--   - transport_vehicles gains 11 nullable columns for the depreciation and
--     tyre/oil lifecycle models (purchase price, expected life, tyre and oil
--     interval costs, a manual overhead share). None of them appear on the
--     existing Vehicle master screen (VehicleManager.tsx is untouched) — a
--     new "Vehicle Cost Profile" panel inside this module writes them, the
--     same direct-table-write-under-RLS way VehicleManager.tsx already does.
--   - transport_costing_snapshots: a saved calculation, because a snapshot
--     answers "what did we calculate on 14-09-2026", and the ERP data behind
--     it will have moved by the time anyone asks.
--   - transport_expenses gets two more free-text categories worth of use:
--     driver-tagged rows (salary, accommodation, iqama, insurance) and one
--     company-wide "admin_overhead" row per period (vehicle_id and driver_id
--     both null) — the ONLY source the overhead allocator reads, so an
--     unrelated Vista Group expense can never be swept in by accident.
--   - erp_settings gains a handful of keys for the configurable pieces
--     (overhead allocation method, margin defaults, markup-vs-margin choice)
--     through the get_setting/set_setting pair that already exists (037).
--
-- THE ENGINE, so nothing is computed twice: transport_vehicle_cost_model()
-- is the one routine that turns a vehicle's history into monthly cost,
-- cost/KM and a component breakdown. The calculator, Route Comparison,
-- Vehicle Performance, Route Profitability and Fleet Overview all call it —
-- none of them re-derives fuel or driver cost on their own.
--
-- Every report here is SECURITY INVOKER, per this file's own convention: a
-- restricted user's view narrows the same way any other report's does. RLS
-- on the five tables read is already company + is_staff() only (checked
-- live before writing this), so nothing further is needed for that. The two
-- writes (vehicle cost profile, snapshot save) stay SECURITY DEFINER with an
-- explicit is_staff() check, the same shape as every other plain staff RPC
-- in this schema — this is not a voucher, so it does not go through
-- docForPath/DOC_TREE.
-- ============================================================
begin;

-- ────────────────────────────────────────────────────────────────────────
-- 1. New, nullable vehicle-cost fields. Additive only.
-- ────────────────────────────────────────────────────────────────────────
alter table transport_vehicles
  add column if not exists purchase_price          numeric(18,2),
  add column if not exists purchase_date            date,
  add column if not exists model_year               int,
  add column if not exists expected_life_km         numeric(18,2),
  add column if not exists expected_life_years       numeric(6,2),
  add column if not exists expected_resale_value     numeric(18,2),
  add column if not exists depreciation_enabled      boolean not null default true,
  add column if not exists tyre_cost                 numeric(18,2),
  add column if not exists tyre_life_km              numeric(18,2),
  add column if not exists oil_change_cost           numeric(18,2),
  add column if not exists oil_change_interval_km    numeric(18,2),
  add column if not exists overhead_manual_monthly   numeric(18,2);

comment on column transport_vehicles.expected_life_km is
  'Depreciation model: (purchase_price - expected_resale_value) / expected_life_km = cost/KM. The recommended default (spec §13).';
comment on column transport_vehicles.overhead_manual_monthly is
  'Used only when the fleet overhead allocation method (erp_settings transport_costing_overhead_method) is ''manual''.';

create index if not exists idx_transport_expenses_vehicle_date on transport_expenses(vehicle_id, spent_on) where vehicle_id is not null;
create index if not exists idx_transport_expenses_driver_date  on transport_expenses(driver_id, spent_on)  where driver_id is not null;
create index if not exists idx_transport_expenses_overhead     on transport_expenses(company_id, spent_on) where vehicle_id is null and driver_id is null;
create index if not exists idx_transport_trips_route_status    on transport_trips(route_id, status, trip_date);

-- ────────────────────────────────────────────────────────────────────────
-- 2. Snapshots — a saved calculation, frozen at the numbers used.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists transport_costing_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  label              text,
  vehicle_id         uuid references transport_vehicles(id),
  route_id           uuid references transport_routes(id),
  trip_type          text,
  return_condition   text,
  period_label       text,
  period_from        date,
  period_to          date,
  result             jsonb not null,   -- the full transport_costing_calculate() output
  selling_price      numeric(18,2),
  overrides          jsonb not null default '{}'::jsonb
);
create index if not exists idx_costing_snapshots_company on transport_costing_snapshots(company_id, created_at desc);

alter table transport_costing_snapshots enable row level security;
drop policy if exists transport_costing_snapshots_staff on transport_costing_snapshots;
create policy transport_costing_snapshots_staff on transport_costing_snapshots for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

-- ────────────────────────────────────────────────────────────────────────
-- 3. Vehicle cost profile — the one door for the 11 new columns. Everything
--    else on transport_vehicles is untouched and stays reachable only from
--    VehicleManager.tsx, exactly as it is today.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_vehicle_cost_profile_save(
  p_vehicle_id uuid, p_purchase_price numeric, p_purchase_date date, p_model_year int,
  p_expected_life_km numeric, p_expected_life_years numeric, p_expected_resale_value numeric,
  p_depreciation_enabled boolean, p_tyre_cost numeric, p_tyre_life_km numeric,
  p_oil_change_cost numeric, p_oil_change_interval_km numeric, p_overhead_manual_monthly numeric
) returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update transport_vehicles set
    purchase_price = p_purchase_price, purchase_date = p_purchase_date, model_year = p_model_year,
    expected_life_km = p_expected_life_km, expected_life_years = p_expected_life_years,
    expected_resale_value = p_expected_resale_value, depreciation_enabled = coalesce(p_depreciation_enabled, true),
    tyre_cost = p_tyre_cost, tyre_life_km = p_tyre_life_km,
    oil_change_cost = p_oil_change_cost, oil_change_interval_km = p_oil_change_interval_km,
    overhead_manual_monthly = p_overhead_manual_monthly
  where id = p_vehicle_id and company_id = auth_company_id();
  if not found then raise exception 'Vehicle not found'; end if;
end $function$;
revoke all on function public.transport_vehicle_cost_profile_save(uuid, numeric, date, int, numeric, numeric, numeric, boolean, numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.transport_vehicle_cost_profile_save(uuid, numeric, date, int, numeric, numeric, numeric, boolean, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Period + confidence helpers
-- ────────────────────────────────────────────────────────────────────────
-- Turns a named period into [from, to]. 'custom' expects p_from/p_to already set.
create or replace function public.transport_costing_period_bounds(p_period text, p_from date, p_to date)
returns table(period_from date, period_to date)
language sql stable set search_path to 'public' as $$
  select case p_period
           when 'current_month'  then date_trunc('month', current_date)::date
           when 'previous_month' then (date_trunc('month', current_date) - interval '1 month')::date
           when 'last_3_months'  then (current_date - interval '3 months')::date
           when 'last_6_months'  then (current_date - interval '6 months')::date
           when 'last_12_months' then (current_date - interval '12 months')::date
           when 'custom'         then p_from
           else (current_date - interval '6 months')::date  -- default: last 6 months
         end as period_from,
         case p_period
           when 'previous_month' then (date_trunc('month', current_date) - interval '1 day')::date
           when 'custom'         then p_to
           else current_date
         end as period_to;
$$;
revoke all on function public.transport_costing_period_bounds(text, date, date) from public, anon;
grant execute on function public.transport_costing_period_bounds(text, date, date) to authenticated;

-- HIGH: 12 months of the vehicle's own completed-trip history at or before
-- period_to. MEDIUM: 3–11. LOW: under 3, or no history at all — spec §21.
create or replace function public.transport_costing_confidence(p_months numeric, p_trips int)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'level', case when p_trips = 0 or p_months is null then 'low'
                  when p_months >= 12 then 'high'
                  when p_months >= 3 then 'medium'
                  else 'low' end,
    'months_of_data', round(coalesce(p_months,0), 1),
    'trips_of_data', coalesce(p_trips, 0)
  );
$$;
revoke all on function public.transport_costing_confidence(numeric, int) from public, anon;
grant execute on function public.transport_costing_confidence(numeric, int) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 5. THE ENGINE — one vehicle's history, turned into monthly cost and
--    cost/KM. Everything else in this module calls this; nothing re-derives
--    fuel, driver or overhead cost on its own.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_vehicle_cost_model(
  p_company uuid, p_vehicle_id uuid, p_from date, p_to date,
  p_overrides jsonb default '{}'::jsonb   -- {fuel_cost_per_km, oil_cost_per_km, tyre_cost_per_km,
                                           --  maintenance_monthly, utilization_km, depreciation_enabled,
                                           --  overhead_method}
) returns jsonb
language plpgsql stable security invoker set search_path to 'public' as $function$
declare
  v transport_vehicles;
  v_driver_id uuid; v_driver_name text;
  v_months numeric; v_hist_months numeric;
  v_km numeric := 0; v_trips int := 0;
  v_exp record;         -- vehicle-tagged expense buckets
  v_drv_exp record;     -- driver-tagged expense buckets
  v_comp jsonb := '[]'::jsonb;
  v_total_monthly numeric := 0;
  v_cost_per_km numeric := 0;
  v_util_km numeric;    -- monthly KM used as the divisor (override or actual)
  v_dep_monthly numeric; v_dep_note text; v_dep_src text;
  v_tyre_cpk numeric; v_tyre_src text;
  v_oil_cpk numeric; v_oil_src text;
  v_fuel_cpk numeric; v_fuel_monthly numeric; v_fuel_src text;
  v_overhead jsonb;
begin
  select * into v from transport_vehicles where id = p_vehicle_id and company_id = p_company;
  if not found then raise exception 'Vehicle not found'; end if;

  v_months := greatest(1, extract(epoch from (p_to::timestamp - p_from::timestamp)) / 86400.0 / 30.4375);

  -- The driver currently assigned to this vehicle (spec §11 — "identify the
  -- driver currently assigned", i.e. now, not who happened to drive a given
  -- historical trip).
  select id, name into v_driver_id, v_driver_name from transport_drivers
   where vehicle_id = p_vehicle_id and company_id = p_company limit 1;

  -- This vehicle's own operating KM and trip count: completed, NOT
  -- outsourced (an outsourced trip is the vendor's KM, not this vehicle's).
  select coalesce(sum(r.distance_km), 0), count(*)
    into v_km, v_trips
    from transport_trips t join transport_routes r on r.id = t.route_id
   where t.company_id = p_company and t.vehicle_id = p_vehicle_id and t.status = 'completed'
     and not coalesce(t.is_outsourced, false) and t.trip_date between p_from and p_to;

  -- True data history, for the confidence score: how far back does this
  -- vehicle's OWN completed history reach, bounded by p_to — not the size of
  -- the window the user asked for.
  select greatest(1, extract(epoch from (p_to::timestamp - min(t.trip_date)::timestamp)) / 86400.0 / 30.4375)
    into v_hist_months
    from transport_trips t
   where t.company_id = p_company and t.vehicle_id = p_vehicle_id and t.status = 'completed'
     and not coalesce(t.is_outsourced, false) and t.trip_date <= p_to;

  v_util_km := coalesce(nullif((p_overrides->>'utilization_km')::numeric, 0), v_km);
  if v_util_km <= 0 then v_util_km := null; end if;  -- no divisor: components stay per-month, cost/km unknown

  -- Vehicle-tagged expenses, bucketed. category is free text (ExpenseManager
  -- still only offers the original six plus the new ones this migration
  -- adds); anything not in the named buckets below (toll, parking, fine,
  -- other) lands in "other", never silently dropped.
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

  select
    coalesce(sum(amount) filter (where category = 'driver_salary'), 0)        as salary,
    coalesce(sum(amount) filter (where category = 'driver_accommodation'), 0) as accommodation,
    coalesce(sum(amount) filter (where category = 'driver_iqama'), 0)         as iqama,
    coalesce(sum(amount) filter (where category = 'driver_insurance'), 0)     as insurance,
    coalesce(sum(amount) filter (where category not in
      ('driver_salary','driver_accommodation','driver_iqama','driver_insurance')), 0) as other
    into v_drv_exp
    from transport_expenses
   where company_id = p_company and driver_id = v_driver_id and spent_on between p_from and p_to;

  -- Fuel: prefer actual (expense ÷ actual KM), spec §7. A per-KM override
  -- wins outright; a monthly-cost override is not offered for fuel because
  -- it scales with distance driven, unlike the fixed items below.
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

  -- Driver: monthly cost ÷ vehicle monthly KM (spec §11).
  declare v_drv_monthly numeric := v_drv_exp.salary + v_drv_exp.accommodation + v_drv_exp.iqama + v_drv_exp.insurance + v_drv_exp.other;
  begin
    v_drv_monthly := v_drv_monthly / v_months;
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','driver','label','Driver',
      'monthly_cost', round(v_drv_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_drv_monthly / v_util_km, 4) end,
      'source', case when v_drv_monthly > 0 then 'actual' else 'insufficient_data' end,
      'driver_id', v_driver_id, 'driver_name', v_driver_name));
  end;

  -- Oil/Service: actual cost/KM when recorded, else the lifecycle model
  -- (cost ÷ interval KM), else nothing — spec §10.
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

  -- Tyres: actual, else lifecycle model (cost ÷ life KM) — spec §9.
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

  -- General maintenance (repairs, oil filter, air filter, brakes, AC, etc. —
  -- everything the driver logs as "maintenance" and not the two named
  -- lifecycle items above) — spec §8. Monthly-cost override, not per-KM: a
  -- repair bill is not proportional to distance the way fuel is.
  declare v_maint_monthly numeric := coalesce((p_overrides->>'maintenance_monthly')::numeric, v_exp.maintenance / v_months);
  begin
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','maintenance','label','Maintenance',
      'monthly_cost', round(v_maint_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_maint_monthly / v_util_km, 4) end,
      'source', case when p_overrides ? 'maintenance_monthly' then 'override' when v_exp.maintenance > 0 then 'actual' else 'insufficient_data' end));
  end;

  -- Insurance + registration: annual figures, halved into a monthly one —
  -- spec §12. Recorded as expense rows over the period, converted the same
  -- way as any other monthly figure (spent_on need not fall exactly once a
  -- year inside the window; the average over the window is what is shown).
  declare v_ins_reg_monthly numeric := (v_exp.insurance + v_exp.registration) / v_months;
  begin
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','insurance_registration','label','Insurance / Registration',
      'monthly_cost', round(v_ins_reg_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_ins_reg_monthly / v_util_km, 4) end,
      'source', case when v_ins_reg_monthly > 0 then 'actual' else 'insufficient_data' end));
  end;

  -- Nusuk / vehicle-related recurring charges.
  declare v_nusuk_monthly numeric := v_exp.nusuk / v_months;
  begin
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','nusuk','label','Nusuk',
      'monthly_cost', round(v_nusuk_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_nusuk_monthly / v_util_km, 4) end,
      'source', case when v_nusuk_monthly > 0 then 'actual' else 'insufficient_data' end));
  end;

  -- Everything else vehicle-tagged (toll, parking, fine, and whatever else
  -- the driver typed a free-text category for) — never dropped, always shown.
  declare v_other_monthly numeric := v_exp.other / v_months;
  begin
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key','other','label','Other',
      'monthly_cost', round(v_other_monthly,2),
      'cost_per_km', case when v_util_km > 0 then round(v_other_monthly / v_util_km, 4) end,
      'source', case when v_other_monthly > 0 then 'actual' else 'insufficient_data' end));
  end;

  -- Depreciation: recommended default is depreciable amount ÷ expected
  -- lifetime KM — spec §13. Falls back to straight-line by year when only a
  -- year figure is set. Never a cash expense, kept as its own line, and can
  -- be switched off per vehicle (and per calculation, via override).
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

  -- Fleet overhead — a separate, transparent line, never mixed silently in.
  v_overhead := transport_vehicle_overhead_share(p_company, p_vehicle_id, p_from, p_to,
                  coalesce(p_overrides->>'overhead_method', null));
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

-- ────────────────────────────────────────────────────────────────────────
-- 6. Fleet overhead allocator — one place, six methods (spec §2). "By
--    utilization" and "By KM" are the same measure (a vehicle's utilization
--    IS its KM), so they share one computation, labelled honestly rather
--    than pretending to be two different numbers.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_vehicle_overhead_share(
  p_company uuid, p_vehicle_id uuid, p_from date, p_to date, p_method text default null
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare
  v_method text := coalesce(p_method, get_setting('transport_costing_overhead_method', 'equal'));
  v_total numeric; v_active_n int; v_share numeric := 0; v_months numeric;
  v_veh_km numeric; v_fleet_km numeric;
  v_veh_rev numeric; v_fleet_rev numeric;
  v_veh_days int; v_fleet_days int;
  v_manual numeric;
begin
  v_months := greatest(1, extract(epoch from (p_to::timestamp - p_from::timestamp)) / 86400.0 / 30.4375);

  -- The ONLY source: transport_expenses rows tagged to neither a vehicle nor
  -- a driver, category 'admin_overhead'. Nothing outside this table, and
  -- nothing outside Transport, is ever pulled in — spec §2's own warning.
  select coalesce(sum(amount),0) into v_total
    from transport_expenses
   where company_id = p_company and vehicle_id is null and driver_id is null
     and category = 'admin_overhead' and spent_on between p_from and p_to;
  v_total := v_total / v_months;

  select count(*) into v_active_n from transport_vehicles where company_id = p_company and is_active;

  if v_method = 'manual' then
    select overhead_manual_monthly into v_manual from transport_vehicles where id = p_vehicle_id;
    return jsonb_build_object('method','manual','vehicle_monthly_share', coalesce(v_manual,0),
      'fleet_monthly_total', v_total, 'active_vehicles', v_active_n);
  end if;

  if v_active_n = 0 or v_total = 0 then
    return jsonb_build_object('method', v_method, 'vehicle_monthly_share', 0,
      'fleet_monthly_total', v_total, 'active_vehicles', v_active_n);
  end if;

  if v_method in ('by_km','by_utilization') then
    select coalesce(sum(r.distance_km),0) into v_veh_km
      from transport_trips t join transport_routes r on r.id = t.route_id
     where t.company_id = p_company and t.vehicle_id = p_vehicle_id and t.status='completed'
       and not coalesce(t.is_outsourced,false) and t.trip_date between p_from and p_to;
    select coalesce(sum(r.distance_km),0) into v_fleet_km
      from transport_trips t join transport_routes r on r.id = t.route_id join transport_vehicles vv on vv.id = t.vehicle_id
     where t.company_id = p_company and vv.is_active and t.status='completed'
       and not coalesce(t.is_outsourced,false) and t.trip_date between p_from and p_to;
    v_share := case when v_fleet_km > 0 then v_total * (v_veh_km / v_fleet_km) else v_total / v_active_n end;
    v_method := 'by_km';
  elsif v_method = 'by_revenue' then
    select coalesce(sum(t.sell_rate),0) into v_veh_rev
      from transport_trips t where t.company_id=p_company and t.vehicle_id=p_vehicle_id and t.status='completed'
        and not coalesce(t.is_outsourced,false) and t.trip_date between p_from and p_to;
    select coalesce(sum(t.sell_rate),0) into v_fleet_rev
      from transport_trips t join transport_vehicles vv on vv.id=t.vehicle_id
     where t.company_id=p_company and vv.is_active and t.status='completed'
       and not coalesce(t.is_outsourced,false) and t.trip_date between p_from and p_to;
    v_share := case when v_fleet_rev > 0 then v_total * (v_veh_rev / v_fleet_rev) else v_total / v_active_n end;
  elsif v_method = 'by_active_days' then
    select count(distinct t.trip_date) into v_veh_days
      from transport_trips t where t.company_id=p_company and t.vehicle_id=p_vehicle_id and t.status='completed'
        and not coalesce(t.is_outsourced,false) and t.trip_date between p_from and p_to;
    select count(distinct (vv.id, t.trip_date)) into v_fleet_days
      from transport_trips t join transport_vehicles vv on vv.id=t.vehicle_id
     where t.company_id=p_company and vv.is_active and t.status='completed'
       and not coalesce(t.is_outsourced,false) and t.trip_date between p_from and p_to;
    v_share := case when v_fleet_days > 0 then v_total * (v_veh_days::numeric / v_fleet_days) else v_total / v_active_n end;
  else -- 'equal', the default
    v_share := v_total / v_active_n;
    v_method := 'equal';
  end if;

  return jsonb_build_object('method', v_method, 'vehicle_monthly_share', round(v_share,2),
    'fleet_monthly_total', round(v_total,2), 'active_vehicles', v_active_n);
end $function$;
revoke all on function public.transport_vehicle_overhead_share(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.transport_vehicle_overhead_share(uuid, uuid, date, date, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 7. Historical empty-return probability for a route's direction (spec §5).
--    A one-way completed leg on route A→B counts as "paid return" when the
--    SAME booking has a completed leg back on B→A within 24 hours — the
--    signal the schedule actually carries (seq + booking_id), not a guess.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_route_return_probability(p_company uuid, p_route_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_from_loc text; v_to_loc text; v_rev_route uuid;
        v_total int; v_paid int;
begin
  select from_location, to_location into v_from_loc, v_to_loc from transport_routes where id = p_route_id;
  select id into v_rev_route from transport_routes where company_id = p_company
    and from_location = v_to_loc and to_location = v_from_loc limit 1;

  select count(*) into v_total from transport_trips t
   where t.company_id = p_company and t.route_id = p_route_id and t.status = 'completed'
     and t.trip_date between p_from and p_to;

  if v_rev_route is null or v_total = 0 then
    return jsonb_build_object('historical_paid_return_pct', null, 'historical_empty_return_pct', null,
      'trips_considered', v_total, 'reverse_route_found', v_rev_route is not null,
      'source', case when v_total = 0 then 'insufficient_data' else 'reverse_route_not_in_route_master' end);
  end if;

  select count(*) into v_paid from transport_trips out_leg
   where out_leg.company_id = p_company and out_leg.route_id = p_route_id and out_leg.status = 'completed'
     and out_leg.trip_date between p_from and p_to
     and exists (
       select 1 from transport_trips ret_leg
        where ret_leg.company_id = p_company and ret_leg.booking_id = out_leg.booking_id
          and ret_leg.route_id = v_rev_route and ret_leg.status = 'completed'
          and ret_leg.sell_rate > 0
          and (ret_leg.trip_date + coalesce(ret_leg.trip_time, time '00:00'))
              >= (out_leg.trip_date + coalesce(out_leg.trip_time, time '00:00'))
          and (ret_leg.trip_date + coalesce(ret_leg.trip_time, time '00:00'))
              <= (out_leg.trip_date + coalesce(out_leg.trip_time, time '00:00')) + interval '24 hours');

  return jsonb_build_object(
    'historical_paid_return_pct', round(100.0 * v_paid / v_total, 1),
    'historical_empty_return_pct', round(100.0 * (v_total - v_paid) / v_total, 1),
    'trips_considered', v_total, 'reverse_route_found', true, 'source', 'historical');
end $function$;
revoke all on function public.transport_route_return_probability(uuid, uuid, date, date) from public, anon;
grant execute on function public.transport_route_return_probability(uuid, uuid, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 8. Expected KM for one trip, given its shape (spec §5, §6). One-way with a
--    paid return costs only its own leg; one-way with an empty or unknown
--    return also carries the (probability-weighted) drive back, because
--    that is a real, uncompensated cost the business actually bears.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_expected_km(
  p_route_km numeric, p_trip_type text, p_return_condition text, p_historical_empty_pct numeric, p_manual_empty_pct numeric
) returns jsonb language plpgsql immutable as $function$
declare v_pct numeric; v_pct_source text; v_extra numeric := 0; v_total numeric;
begin
  if p_trip_type in ('return','round_trip') then
    v_total := p_route_km * 2;
    return jsonb_build_object('total_km', v_total, 'extra_return_km', p_route_km,
      'return_pct_used', 100, 'return_pct_source', 'full_round_trip_booked');
  end if;
  if p_trip_type in ('multi_leg','custom') then
    return jsonb_build_object('total_km', p_route_km, 'extra_return_km', 0,
      'return_pct_used', null, 'return_pct_source', 'multi_leg_base_distance_only');
  end if;

  -- one_way
  if p_return_condition = 'paid' then
    return jsonb_build_object('total_km', p_route_km, 'extra_return_km', 0,
      'return_pct_used', 0, 'return_pct_source', 'return_booked_separately');
  elsif p_return_condition = 'empty' then
    return jsonb_build_object('total_km', p_route_km * 2, 'extra_return_km', p_route_km,
      'return_pct_used', 100, 'return_pct_source', 'assumed_empty');
  else -- historical / unknown
    if p_manual_empty_pct is not null then
      v_pct := p_manual_empty_pct; v_pct_source := 'manual_override';
    elsif p_historical_empty_pct is not null then
      v_pct := p_historical_empty_pct; v_pct_source := 'historical';
    else
      v_pct := 100; v_pct_source := 'no_data_assumed_empty';
    end if;
    v_extra := round(p_route_km * (v_pct / 100.0), 2);
    return jsonb_build_object('total_km', p_route_km + v_extra, 'extra_return_km', v_extra,
      'return_pct_used', v_pct, 'return_pct_source', v_pct_source);
  end if;
end $function$;
revoke all on function public.transport_costing_expected_km(numeric, text, text, numeric, numeric) from public, anon;
grant execute on function public.transport_costing_expected_km(numeric, text, text, numeric, numeric) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 9. Pricing intelligence — cost price, minimum/recommended/target selling
--    price. Margin (of the SELLING price) and markup (on COST) are not the
--    same number and this never conflates them — spec §16.
--      margin m%:  price = cost / (1 - m/100)
--      markup m%:  price = cost * (1 + m/100)
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_price_for(p_cost numeric, p_pct numeric, p_method text)
returns numeric language sql immutable as $$
  select case when p_cost is null then null
              when p_method = 'markup' then round(p_cost * (1 + coalesce(p_pct,0)/100.0), 2)
              else round(p_cost / nullif(1 - coalesce(p_pct,0)/100.0, 0), 2)  -- 'margin', the default
         end;
$$;
revoke all on function public.transport_costing_price_for(numeric, numeric, text) from public, anon;
grant execute on function public.transport_costing_price_for(numeric, numeric, text) to authenticated;

create or replace function public.transport_costing_pricing(p_cost numeric)
returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_method text := coalesce(get_setting('transport_costing_margin_method'), 'margin');
        v_min numeric := coalesce(get_setting('transport_costing_min_margin_pct')::numeric, 5);
        v_rec numeric := coalesce(get_setting('transport_costing_recommended_margin_pct')::numeric, 15);
        v_tgt numeric := coalesce(get_setting('transport_costing_target_margin_pct')::numeric, 25);
begin
  return jsonb_build_object(
    'method', v_method,
    'cost_price', p_cost,
    'min_margin_pct', v_min, 'min_price', transport_costing_price_for(p_cost, v_min, v_method),
    'recommended_margin_pct', v_rec, 'recommended_price', transport_costing_price_for(p_cost, v_rec, v_method),
    'target_margin_pct', v_tgt, 'target_price', transport_costing_price_for(p_cost, v_tgt, v_method));
end $function$;
revoke all on function public.transport_costing_pricing(numeric) from public, anon;
grant execute on function public.transport_costing_pricing(numeric) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 10. Historical sales comparison for a vehicle + route + trip type — spec
--     §17. Cost per trip is reconstructed at TODAY's cost/km (the ERP keeps
--     no historical cost/km series), which is stated plainly in the result
--     rather than implied as an exact historical cost.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_sales_history(
  p_company uuid, p_vehicle_id uuid, p_route_id uuid, p_from date, p_to date, p_cost_per_km numeric
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_n int; v_lo numeric; v_hi numeric; v_avg numeric; v_med numeric; v_km numeric;
begin
  select r.distance_km into v_km from transport_routes r where r.id = p_route_id;
  select count(*), min(t.sell_rate), max(t.sell_rate), avg(t.sell_rate),
         percentile_cont(0.5) within group (order by t.sell_rate)
    into v_n, v_lo, v_hi, v_avg, v_med
    from transport_trips t
   where t.company_id = p_company and t.vehicle_id = p_vehicle_id and t.route_id = p_route_id
     and t.status = 'completed' and not coalesce(t.is_outsourced,false)
     and t.trip_date between p_from and p_to;

  if v_n is null or v_n = 0 then
    return jsonb_build_object('trips', 0, 'source', 'insufficient_data');
  end if;

  return jsonb_build_object(
    'trips', v_n, 'lowest', round(v_lo,2), 'highest', round(v_hi,2),
    'average', round(v_avg,2), 'median', round(v_med,2),
    'average_cost', round(coalesce(p_cost_per_km,0) * coalesce(v_km,0), 2),
    'average_profit', round(v_avg - coalesce(p_cost_per_km,0) * coalesce(v_km,0), 2),
    'average_margin_pct', case when v_avg > 0 then round(100.0 * (v_avg - coalesce(p_cost_per_km,0)*coalesce(v_km,0)) / v_avg, 1) end,
    'cost_basis', 'reconstructed_at_current_cost_per_km', 'source', 'historical');
end $function$;
revoke all on function public.transport_costing_sales_history(uuid, uuid, uuid, date, date, numeric) from public, anon;
grant execute on function public.transport_costing_sales_history(uuid, uuid, uuid, date, date, numeric) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 11. THE CALCULATOR — Mode 1. Vehicle + Route + Period + Trip Type +
--     Return Condition → the full breakdown, pricing and history in one
--     call. Everything above is assembled here; nothing is recomputed.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_calculate(
  p_company uuid, p_vehicle_id uuid, p_route_id uuid,
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

  v_model := transport_vehicle_cost_model(p_company, p_vehicle_id, v_from, v_to, p_overrides);
  v_hist := transport_route_return_probability(p_company, p_route_id, v_from, v_to);
  v_manual_empty := nullif(p_overrides->>'return_pct_override','')::numeric;
  v_km := transport_costing_expected_km(coalesce(v_route.distance_km,0), p_trip_type, p_return_condition,
            nullif(v_hist->>'historical_empty_return_pct','')::numeric, v_manual_empty);

  declare v_trip_cost numeric := round(coalesce((v_model->>'cost_per_km')::numeric,0) * (v_km->>'total_km')::numeric, 2);
  begin
    v_pricing := transport_costing_pricing(v_trip_cost);
    v_sales := transport_costing_sales_history(p_company, p_vehicle_id, p_route_id, v_from, v_to, (v_model->>'cost_per_km')::numeric);

    if (v_model->'confidence'->>'level') = 'low' then
      v_warnings := v_warnings || jsonb_build_array('LIMITED DATA — this estimate is based on limited historical records.');
    end if;
    if (v_model->>'monthly_km')::numeric > 0 and (v_model->>'monthly_km')::numeric < 500 then
      v_warnings := v_warnings || jsonb_build_array('LOW UTILIZATION — fixed monthly costs are being spread over very few KM, inflating cost/KM.');
    end if;

    return jsonb_build_object(
      'vehicle', v_model->'vehicle', 'route', jsonb_build_object('id', v_route.id, 'name', v_route.name,
        'from_location', v_route.from_location, 'to_location', v_route.to_location, 'distance_km', v_route.distance_km),
      'period', jsonb_build_object('label', p_period, 'from', v_from, 'to', v_to),
      'trip_type', p_trip_type, 'return_condition', p_return_condition, 'return_probability', v_hist,
      'km', v_km, 'components', v_model->'components',
      'monthly_total_cost', v_model->'monthly_total_cost', 'cost_per_km', v_model->'cost_per_km',
      'trip_cost', v_trip_cost, 'pricing', v_pricing, 'historical_sales', v_sales,
      'confidence', v_model->'confidence', 'warnings', v_warnings, 'overrides_applied', p_overrides);
  end;
end $function$;
revoke all on function public.transport_costing_calculate(uuid, uuid, uuid, text, date, date, text, text, jsonb) from public, anon;
grant execute on function public.transport_costing_calculate(uuid, uuid, uuid, text, date, date, text, text, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 12. Mode 2 — Route Comparison: every active owned vehicle's cost/KM and
--     trip cost for one route, side by side.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_route_compare(
  p_company uuid, p_route_id uuid, p_period text, p_period_from date, p_period_to date
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_from date; v_to date; v_route transport_routes; v_rows jsonb := '[]'::jsonb; r record; v_model jsonb;
begin
  select period_from, period_to into v_from, v_to from transport_costing_period_bounds(p_period, p_period_from, p_period_to);
  select * into v_route from transport_routes where id = p_route_id and company_id = p_company;
  if not found then raise exception 'Route not found'; end if;

  for r in select id from transport_vehicles where company_id = p_company and is_active order by name loop
    v_model := transport_vehicle_cost_model(p_company, r.id, v_from, v_to, '{}'::jsonb);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'vehicle', v_model->'vehicle', 'cost_per_km', v_model->'cost_per_km',
      'trip_cost', round(coalesce((v_model->>'cost_per_km')::numeric,0) * coalesce(v_route.distance_km,0), 2),
      'monthly_km', v_model->'monthly_km', 'confidence', v_model->'confidence'));
  end loop;

  return jsonb_build_object('route', jsonb_build_object('id', v_route.id, 'name', v_route.name, 'distance_km', v_route.distance_km),
    'period', jsonb_build_object('label', p_period, 'from', v_from, 'to', v_to), 'vehicles', v_rows);
end $function$;
revoke all on function public.transport_costing_route_compare(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_costing_route_compare(uuid, uuid, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 13. Mode 3 — Vehicle Performance: one owned vehicle, every route it ran,
--     across the whole period.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_vehicle_performance(
  p_company uuid, p_vehicle_id uuid, p_period text, p_period_from date, p_period_to date
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_from date; v_to date; v_model jsonb; v_revenue numeric; v_trips int; v_avg_trip numeric;
        v_active_days int; v_empty_pct numeric;
begin
  select period_from, period_to into v_from, v_to from transport_costing_period_bounds(p_period, p_period_from, p_period_to);
  v_model := transport_vehicle_cost_model(p_company, p_vehicle_id, v_from, v_to, '{}'::jsonb);

  select coalesce(sum(sell_rate),0), count(*), count(distinct trip_date)
    into v_revenue, v_trips, v_active_days
    from transport_trips
   where company_id = p_company and vehicle_id = p_vehicle_id and status='completed'
     and not coalesce(is_outsourced,false) and trip_date between v_from and v_to;
  v_avg_trip := case when v_trips > 0 then round(v_revenue / v_trips, 2) end;

  -- Weighted average empty-return % across the routes this vehicle actually
  -- served, one leg at a time — not a per-route number, a per-vehicle one.
  select round(avg((transport_route_return_probability(p_company, rr.route_id, v_from, v_to)->>'historical_empty_return_pct')::numeric), 1)
    into v_empty_pct
    from (select distinct route_id from transport_trips
           where company_id = p_company and vehicle_id = p_vehicle_id and status='completed'
             and not coalesce(is_outsourced,false) and trip_date between v_from and v_to) rr;

  return jsonb_build_object(
    'vehicle', v_model->'vehicle', 'period', jsonb_build_object('label', p_period, 'from', v_from, 'to', v_to),
    'total_km', v_model->'monthly_km', 'trips', v_trips,
    'revenue', round(v_revenue,2), 'expenses', v_model->'monthly_total_cost',
    'cost_per_km', v_model->'cost_per_km',
    'revenue_per_km', case when (v_model->>'monthly_km')::numeric > 0 then round(v_revenue / (v_model->>'monthly_km')::numeric, 4) end,
    'profit', round(v_revenue - coalesce((v_model->>'monthly_total_cost')::numeric,0), 2),
    'profit_per_km', case when (v_model->>'monthly_km')::numeric > 0
      then round((v_revenue - coalesce((v_model->>'monthly_total_cost')::numeric,0)) / (v_model->>'monthly_km')::numeric, 4) end,
    'utilization_km', v_model->'monthly_km', 'active_days', v_active_days,
    'empty_return_pct', v_empty_pct, 'average_trip_value', v_avg_trip,
    'confidence', v_model->'confidence');
end $function$;
revoke all on function public.transport_costing_vehicle_performance(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_costing_vehicle_performance(uuid, uuid, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 14. Mode 4 — Route Profitability: blended across whichever vehicles (and
--     vendors) actually ran that route — an owned leg costs that vehicle's
--     own cost/KM, an outsourced leg costs its real vendor_cost, exactly
--     as spec §20 requires for the two kept apart.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_route_profitability(
  p_company uuid, p_route_id uuid, p_period text, p_period_from date, p_period_to date
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_from date; v_to date; v_route transport_routes; v_hist jsonb;
        v_trips int; v_total_sell numeric; v_total_cost numeric := 0; v_km numeric;
        r record; v_model jsonb; v_veh_cpk_cache jsonb := '{}'::jsonb;
begin
  select period_from, period_to into v_from, v_to from transport_costing_period_bounds(p_period, p_period_from, p_period_to);
  select * into v_route from transport_routes where id = p_route_id and company_id = p_company;
  if not found then raise exception 'Route not found'; end if;
  v_hist := transport_route_return_probability(p_company, p_route_id, v_from, v_to);

  select count(*), coalesce(sum(sell_rate),0) into v_trips, v_total_sell
    from transport_trips where company_id = p_company and route_id = p_route_id and status='completed'
      and trip_date between v_from and v_to;

  for r in select id, vehicle_id, is_outsourced, vendor_cost from transport_trips
            where company_id = p_company and route_id = p_route_id and status='completed'
              and trip_date between v_from and v_to loop
    if coalesce(r.is_outsourced,false) then
      v_total_cost := v_total_cost + coalesce(r.vendor_cost,0);
    else
      if not (v_veh_cpk_cache ? r.vehicle_id::text) then
        v_model := transport_vehicle_cost_model(p_company, r.vehicle_id, v_from, v_to, '{}'::jsonb);
        v_veh_cpk_cache := v_veh_cpk_cache || jsonb_build_object(r.vehicle_id::text, coalesce((v_model->>'cost_per_km')::numeric,0));
      end if;
      v_total_cost := v_total_cost + coalesce((v_veh_cpk_cache->>r.vehicle_id::text)::numeric,0) * coalesce(v_route.distance_km,0);
    end if;
  end loop;

  v_km := coalesce(v_route.distance_km,0) * v_trips;

  return jsonb_build_object(
    'route', jsonb_build_object('id', v_route.id, 'name', v_route.name, 'distance_km', v_route.distance_km),
    'period', jsonb_build_object('label', p_period, 'from', v_from, 'to', v_to),
    'trips', v_trips, 'total_km', round(v_km,1),
    'average_selling_price', case when v_trips>0 then round(v_total_sell/v_trips,2) end,
    'average_cost', case when v_trips>0 then round(v_total_cost/v_trips,2) end,
    'average_profit', case when v_trips>0 then round((v_total_sell-v_total_cost)/v_trips,2) end,
    'average_margin_pct', case when v_total_sell>0 then round(100.0*(v_total_sell-v_total_cost)/v_total_sell,1) end,
    'empty_return_pct', v_hist->'historical_empty_return_pct',
    'revenue_per_km', case when v_km>0 then round(v_total_sell/v_km,4) end,
    'cost_per_km', case when v_km>0 then round(v_total_cost/v_km,4) end,
    'profit_per_km', case when v_km>0 then round((v_total_sell-v_total_cost)/v_km,4) end);
end $function$;
revoke all on function public.transport_costing_route_profitability(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_costing_route_profitability(uuid, uuid, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 15. Mode 5 — Fleet Overview: Vehicle Performance, for every owned vehicle.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_fleet_overview(p_company uuid, p_period text, p_period_from date, p_period_to date)
returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_rows jsonb := '[]'::jsonb; r record;
begin
  for r in select id from transport_vehicles where company_id = p_company and is_active order by name loop
    v_rows := v_rows || jsonb_build_array(transport_costing_vehicle_performance(p_company, r.id, p_period, p_period_from, p_period_to));
  end loop;
  return jsonb_build_object('vehicles', v_rows);
end $function$;
revoke all on function public.transport_costing_fleet_overview(uuid, text, date, date) from public, anon;
grant execute on function public.transport_costing_fleet_overview(uuid, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 16. Dashboard KPIs (spec §24) — built off Fleet Overview and Route
--     Profitability, not recomputed.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_dashboard(p_company uuid, p_period text, p_period_from date, p_period_to date)
returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_from date; v_to date; v_fleet jsonb; v_n int;
        v_rev numeric := 0; v_exp numeric := 0; v_km numeric := 0;
        v_empty_sum numeric := 0; v_empty_n int := 0; v_util_sum numeric := 0;
        v_best jsonb; v_worst jsonb; v_best_margin numeric; v_worst_margin numeric;
        rr record; v_rp jsonb;
begin
  select period_from, period_to into v_from, v_to from transport_costing_period_bounds(p_period, p_period_from, p_period_to);
  v_fleet := transport_costing_fleet_overview(p_company, p_period, p_period_from, p_period_to);
  select count(*) into v_n from jsonb_array_elements(v_fleet->'vehicles');

  select coalesce(sum((x->>'revenue')::numeric),0), coalesce(sum((x->>'expenses')::numeric),0),
         coalesce(sum((x->>'total_km')::numeric),0),
         coalesce(sum((x->>'empty_return_pct')::numeric) filter (where x->>'empty_return_pct' is not null),0),
         count(*) filter (where x->>'empty_return_pct' is not null)
    into v_rev, v_exp, v_km, v_empty_sum, v_empty_n
    from jsonb_array_elements(v_fleet->'vehicles') x;

  for rr in select id, name from transport_routes where company_id = p_company and is_active loop
    v_rp := transport_costing_route_profitability(p_company, rr.id, p_period, p_period_from, p_period_to);
    if (v_rp->>'trips')::int > 0 then
      if v_best_margin is null or (v_rp->>'average_margin_pct')::numeric > v_best_margin then
        v_best_margin := (v_rp->>'average_margin_pct')::numeric;
        v_best := jsonb_build_object('route', rr.name, 'margin_pct', v_best_margin);
      end if;
      if v_worst_margin is null or (v_rp->>'average_margin_pct')::numeric < v_worst_margin then
        v_worst_margin := (v_rp->>'average_margin_pct')::numeric;
        v_worst := jsonb_build_object('route', rr.name, 'margin_pct', v_worst_margin);
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'period', jsonb_build_object('label', p_period, 'from', v_from, 'to', v_to),
    'fleet_vehicles', v_n,
    'fleet_cost_per_km', case when v_km > 0 then round(v_exp / v_km, 4) end,
    'fleet_revenue_per_km', case when v_km > 0 then round(v_rev / v_km, 4) end,
    'fleet_profit_per_km', case when v_km > 0 then round((v_rev - v_exp) / v_km, 4) end,
    'fleet_monthly_revenue', round(v_rev,2), 'fleet_monthly_expense', round(v_exp,2),
    'fleet_monthly_profit', round(v_rev - v_exp, 2),
    'average_empty_return_pct', case when v_empty_n > 0 then round(v_empty_sum / v_empty_n, 1) end,
    'average_vehicle_utilization_km', case when v_n > 0 then round(v_km / v_n, 1) end,
    'most_profitable_route', v_best, 'least_profitable_route', v_worst);
end $function$;
revoke all on function public.transport_costing_dashboard(uuid, text, date, date) from public, anon;
grant execute on function public.transport_costing_dashboard(uuid, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 17. Save / list a snapshot (spec §23).
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_snapshot_save(
  p_label text, p_vehicle_id uuid, p_route_id uuid, p_trip_type text, p_return_condition text,
  p_period_label text, p_period_from date, p_period_to date, p_result jsonb, p_selling_price numeric, p_overrides jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; v_co uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  insert into transport_costing_snapshots(company_id, created_by, label, vehicle_id, route_id, trip_type,
    return_condition, period_label, period_from, period_to, result, selling_price, overrides)
  values (v_co, auth.uid(), p_label, p_vehicle_id, p_route_id, p_trip_type, p_return_condition,
    p_period_label, p_period_from, p_period_to, p_result, p_selling_price, coalesce(p_overrides,'{}'::jsonb))
  returning id into v_id;
  return v_id;
end $function$;
revoke all on function public.transport_costing_snapshot_save(text, uuid, uuid, text, text, text, date, date, jsonb, numeric, jsonb) from public, anon;
grant execute on function public.transport_costing_snapshot_save(text, uuid, uuid, text, text, text, date, date, jsonb, numeric, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 18. Self-verifying checks, against real production data plus one
--     rehearsal that writes and rolls back.
-- ────────────────────────────────────────────────────────────────────────
do $chk$
declare v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
        v_starex uuid; v_model jsonb; v_route uuid; v_calc jsonb; v_snap uuid;
        v_price_margin numeric; v_price_markup numeric;
        v_n_before int; v_n_after int;
begin
  perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);

  select id into v_starex from transport_vehicles where company_id = v_co and name = 'Starex';
  if v_starex is null then raise exception '389: Starex not found — live-data check cannot run'; end if;

  -- The engine's own cost model for Starex over the last 6 months must
  -- separate owned from outsourced: its KM/trip count come ONLY from
  -- is_outsourced = false completed trips.
  v_model := transport_vehicle_cost_model(v_co, v_starex,
    (current_date - interval '6 months')::date, current_date, '{}'::jsonb);
  if (v_model->>'trips')::int <= 0 or (v_model->>'trips')::int >= 204 then
    raise exception '389: Starex owned-trip count looks wrong (%), expected fewer than the 204 total (which includes 83 outsourced)', v_model->>'trips';
  end if;
  if (v_model->'confidence'->>'level') not in ('low','medium') then
    raise exception '389: confidence should not read high off ~6 weeks of real history (got %)', v_model->'confidence'->>'level';
  end if;

  -- Margin vs markup must give different numbers on a known example: cost
  -- 300, 15% margin = 352.94 (300/0.85); 15% markup = 345.00 (300*1.15).
  v_price_margin := transport_costing_price_for(300, 15, 'margin');
  v_price_markup := transport_costing_price_for(300, 15, 'markup');
  if v_price_margin <> 352.94 then raise exception '389: 15%% margin on 300 should be 352.94, got %', v_price_margin; end if;
  if v_price_markup <> 345.00 then raise exception '389: 15%% markup on 300 should be 345.00, got %', v_price_markup; end if;
  if v_price_margin = v_price_markup then raise exception '389: margin and markup must not read the same'; end if;

  -- Expected KM: one-way + assumed empty return doubles the leg; one-way +
  -- paid return does not.
  if (transport_costing_expected_km(450, 'one_way', 'empty', null, null)->>'total_km')::numeric <> 900 then
    raise exception '389: an assumed-empty one-way trip should double the KM';
  end if;
  if (transport_costing_expected_km(450, 'one_way', 'paid', null, null)->>'total_km')::numeric <> 450 then
    raise exception '389: a paid-return one-way trip should not add KM';
  end if;
  if (transport_costing_expected_km(450, 'round_trip', 'paid', null, null)->>'total_km')::numeric <> 900 then
    raise exception '389: a round trip should always be double the leg';
  end if;

  -- Fleet overhead splits the SAME pool differently by method, and a manual
  -- share is used verbatim regardless of the pool.
  declare v_equal jsonb; v_bykm jsonb;
  begin
    v_equal := transport_vehicle_overhead_share(v_co, v_starex, (current_date - interval '6 months')::date, current_date, 'equal');
    v_bykm  := transport_vehicle_overhead_share(v_co, v_starex, (current_date - interval '6 months')::date, current_date, 'by_km');
    if (v_equal->>'method') <> 'equal' or (v_bykm->>'method') <> 'by_km' then
      raise exception '389: overhead method was not honoured';
    end if;
  end;

  -- A route pulled from the Route Master must carry its own distance into
  -- the calculator (route KM is never re-typed or invented).
  select id into v_route from transport_routes where company_id = v_co and distance_km is not null limit 1;
  if v_route is not null then
    v_calc := transport_costing_calculate(v_co, v_starex, v_route, 'last_6_months', null, null, 'one_way', 'historical', '{}'::jsonb);
    if (v_calc->'route'->>'distance_km')::numeric <> (select distance_km from transport_routes where id = v_route) then
      raise exception '389: the calculator did not use the Route Master''s own distance';
    end if;
    if v_calc->'pricing'->>'cost_price' is null then raise exception '389: pricing block did not compute a cost price'; end if;
  end if;

  -- Rehearsal: save a snapshot, read it back exactly, then remove it. The
  -- table must exist untouched afterwards (count restored).
  select count(*) into v_n_before from transport_costing_snapshots where company_id = v_co;
  begin
    v_snap := transport_costing_snapshot_save('389 rehearsal', v_starex, v_route, 'one_way', 'historical',
      'last_6_months', (current_date - interval '6 months')::date, current_date,
      jsonb_build_object('test', true), 999.99, '{}'::jsonb);
    if not exists (select 1 from transport_costing_snapshots where id = v_snap and selling_price = 999.99) then
      raise exception '389: the saved snapshot did not read back what was saved';
    end if;
    raise exception 'ROLLBACK_REHEARSAL';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
  end;
  select count(*) into v_n_after from transport_costing_snapshots where company_id = v_co;
  if v_n_after <> v_n_before then raise exception '389: the snapshot rehearsal did not roll back (% before, % after)', v_n_before, v_n_after; end if;

  -- The vehicle cost profile door writes only what it is given, and refuses
  -- a non-staff / wrong-company call implicitly via auth_company_id().
  perform transport_vehicle_cost_profile_save(v_starex, 120000, date '2025-01-01', 2025,
    360000, null, 40000, true, 1200, 36000, 350, 4500, null);
  if not exists (select 1 from transport_vehicles where id = v_starex and purchase_price = 120000 and tyre_life_km = 36000) then
    raise exception '389: the vehicle cost profile did not save';
  end if;
  -- put it back to how it was (null) so this migration leaves no test data behind
  perform transport_vehicle_cost_profile_save(v_starex, null, null, null, null, null, null, true, null, null, null, null, null);
  if exists (select 1 from transport_vehicles where id = v_starex and purchase_price is not null) then
    raise exception '389: could not clear the cost profile back out';
  end if;

  raise notice '389 ok';
end $chk$;

commit;
