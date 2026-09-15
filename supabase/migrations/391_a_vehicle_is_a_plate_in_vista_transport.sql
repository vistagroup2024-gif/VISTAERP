-- ============================================================
-- 391 — A vehicle is a plate in VISTA TRANSPORT, and its cost is what was
-- actually posted against it
--
-- Two corrections to the Costing module built in 389/390, both from the
-- same live conversation:
--
--   "The expenses which it will use shall take from chart of accounts
--   expense where all expense accounts are there and we select vehicle
--   while creating vouchers."
--
--   "In costing... where we are selecting vehicle, it shall show vehicles
--   which are in tag area master in group named VISTA TRANSPORT."
--
-- WHAT WAS WRONG, found by reading the real data before touching anything:
-- transport_vehicles (Starex, Staria, Camry, Bus, GMC Yukon...) are the
-- CATEGORIES a booking asks for, not physical vehicles — confirmed against
-- Tag_Area.xlsx's own import (370): the VEHICLES > VISTA TRANSPORT group
-- holds exactly 4 leaves, one per PHYSICALLY OWNED plate —
--   STAREX (ATA 4086), STAREX (KDA 6681), STARIA (STA 6390), STARIA (LUXURY)
-- — while VEHICLES > OUTSOURCE VEHICLES holds the vendor-side categories
-- (Camry, Hi Ace, GMC, Bus, Coaster, Train...) that transport_vehicles also
-- lists. So a "vehicle" for costing purposes is one of those 4 plates, and
-- 389's 8-category cost profiles were never the right shape.
--
-- THE EXPENSE SIDE becomes exact rather than a free-text category: every
-- POSTED expense-type account's journal line whose tag_area names this
-- plate IS this plate's cost, whatever the account is — Car Petrol,
-- Vehicle Maintenance, Vehicle Insurance, even a driver's IQAMA EXPENSE if
-- the business chooses to tag that voucher line to this van. This also
-- retires the whole class of bug 390 fixed (a driver's cost bleeding onto
-- the wrong vehicle because driver_id and vehicle_id were crossed): there
-- is no more inference here, only what a human explicitly tagged.
--
-- THE REVENUE SIDE has a real gap this migration does not paper over:
-- transport_trips has never recorded which specific plate ran a trip, only
-- the category booked. Asked directly, the business chose to close this by
-- entering each plate's registration number against the driver currently
-- assigned to it (transport_drivers.vista_vehicle_reg, new) — so a trip is
-- attributed to a plate through who drove it, not logged per-trip. This is
-- an approximation for a driver who changes vehicles mid-period, stated
-- plainly wherever it is used (driver_matched / vehicle_match_source in the
-- engine's own output) rather than hidden.
--
-- Fleet overhead is UNCHANGED by explicit choice (no preference given) — it
-- still reads the one transport_expenses admin_overhead pool; only which
-- vehicles it is split across moves from the 8 categories to the 4 plates.
--
-- transport_vehicles itself, and every existing booking/trip/driver screen
-- that reads it for CATEGORY selection, is untouched — this migration only
-- removes the 11 cost-profile columns 389 added there (unused, still null
-- for all 8 rows; a physical-vehicle profile never belonged on a category
-- row) and moves that concept to a new table keyed on the tag area instead.
-- ============================================================
begin;

-- create or replace cannot rename a parameter; these 7 functions have one
-- renamed (p_vehicle_id -> p_tag_area_id), so they are dropped first.
drop function if exists public.transport_vehicle_cost_profile_save(uuid, numeric, date, int, numeric, numeric, numeric, boolean, numeric, numeric, numeric, numeric, numeric);
drop function if exists public.transport_vehicle_cost_model(uuid, uuid, date, date, jsonb);
drop function if exists public.transport_vehicle_overhead_share(uuid, uuid, date, date, text);
drop function if exists public.transport_costing_sales_history(uuid, uuid, uuid, date, date, numeric);
drop function if exists public.transport_costing_calculate(uuid, uuid, uuid, text, date, date, text, text, jsonb);
drop function if exists public.transport_costing_vehicle_performance(uuid, uuid, text, date, date);
drop function if exists public.transport_costing_snapshot_save(text, uuid, uuid, text, text, text, date, date, jsonb, numeric, jsonb);

-- ────────────────────────────────────────────────────────────────────────
-- 1. transport_drivers gains the plate this driver currently drives, in the
--    business's own words: "enter the plate number in registration no in
--    our drivers list so that this will match easily." Free text, matched
--    against acct_tag_areas.name — the same convention tag_area already
--    uses on vouchers (370: "nothing depends on these names in code" is
--    knowingly broken here, by request, the same way is_car_cost_center()
--    already names a cost centre literal).
-- ────────────────────────────────────────────────────────────────────────
alter table transport_drivers add column if not exists vista_vehicle_reg text;
comment on column transport_drivers.vista_vehicle_reg is
  'The VISTA TRANSPORT tag-area plate (acct_tag_areas.name) of the vehicle this driver currently drives. Set from the same list the Costing module''s vehicle picker uses. Lets a completed trip (which only ever carries driver_id) be matched back to a specific owned plate for costing — an approximation for a driver who changes vehicles mid-period, not a per-trip record.';
create index if not exists idx_transport_drivers_vista_reg on transport_drivers(company_id, vista_vehicle_reg) where vista_vehicle_reg is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 2. Vehicle Cost Profile moves from transport_vehicles (a category table)
--    to its own table keyed on the plate's tag area. Same 11 fields 389
--    added, same purpose (depreciation + tyre/oil lifecycle model + manual
--    overhead), just attached to the right thing.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists transport_vehicle_profiles (
  tag_area_id              uuid primary key references acct_tag_areas(id) on delete cascade,
  company_id               uuid not null references companies(id) on delete cascade,
  purchase_price           numeric(18,2),
  purchase_date            date,
  model_year               int,
  expected_life_km         numeric(18,2),
  expected_life_years      numeric(6,2),
  expected_resale_value    numeric(18,2),
  depreciation_enabled     boolean not null default true,
  tyre_cost                numeric(18,2),
  tyre_life_km             numeric(18,2),
  oil_change_cost          numeric(18,2),
  oil_change_interval_km   numeric(18,2),
  overhead_manual_monthly  numeric(18,2),
  updated_at               timestamptz not null default now()
);
alter table transport_vehicle_profiles enable row level security;
drop policy if exists transport_vehicle_profiles_staff on transport_vehicle_profiles;
create policy transport_vehicle_profiles_staff on transport_vehicle_profiles for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

alter table transport_vehicles
  drop column if exists purchase_price,
  drop column if exists purchase_date,
  drop column if exists model_year,
  drop column if exists expected_life_km,
  drop column if exists expected_life_years,
  drop column if exists expected_resale_value,
  drop column if exists depreciation_enabled,
  drop column if exists tyre_cost,
  drop column if exists tyre_life_km,
  drop column if exists oil_change_cost,
  drop column if exists oil_change_interval_km,
  drop column if exists overhead_manual_monthly;

-- transport_costing_snapshots.vehicle_id pointed at transport_vehicles;
-- repoint it at the tag area. Table is empty (checked live before writing
-- this), so there is no data to carry across.
alter table transport_costing_snapshots drop column if exists vehicle_id;
alter table transport_costing_snapshots add column if not exists vehicle_tag_area_id uuid references acct_tag_areas(id);

create index if not exists idx_journal_lines_tag_area on journal_lines(tag_area) where tag_area is not null;
create index if not exists idx_journal_entries_company_status_date on journal_entries(company_id, status, entry_date);

-- ────────────────────────────────────────────────────────────────────────
-- 3. The vehicle list itself — every active leaf under VEHICLES > VISTA
--    TRANSPORT, with its profile (if set) and its currently-matched
--    driver(s) joined in. This is what the costing UI's picker now reads,
--    everywhere it used to read transport_vehicles.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_vista_vehicles(p_company uuid)
returns table(
  id uuid, name text,
  purchase_price numeric, purchase_date date, model_year int,
  expected_life_km numeric, expected_life_years numeric, expected_resale_value numeric,
  depreciation_enabled boolean, tyre_cost numeric, tyre_life_km numeric,
  oil_change_cost numeric, oil_change_interval_km numeric, overhead_manual_monthly numeric,
  driver_name text, driver_matched boolean
) language sql stable security invoker set search_path to 'public' as $$
  select ta.id, ta.name,
    p.purchase_price, p.purchase_date, p.model_year,
    p.expected_life_km, p.expected_life_years, p.expected_resale_value,
    coalesce(p.depreciation_enabled, true), p.tyre_cost, p.tyre_life_km,
    p.oil_change_cost, p.oil_change_interval_km, p.overhead_manual_monthly,
    d.driver_name, (d.driver_name is not null) as driver_matched
  from acct_tag_areas ta
  join acct_tag_areas grp on grp.id = ta.parent_id and grp.name = 'VISTA TRANSPORT'
  left join transport_vehicle_profiles p on p.tag_area_id = ta.id
  left join lateral (
    select string_agg(dd.name, ', ') as driver_name
      from transport_drivers dd where dd.company_id = p_company and dd.vista_vehicle_reg = ta.name
  ) d on true
  where ta.company_id = p_company and ta.is_group = false and ta.is_active
  order by ta.name;
$$;
revoke all on function public.transport_vista_vehicles(uuid) from public, anon;
grant execute on function public.transport_vista_vehicles(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Vehicle cost profile — the one door, now keyed on the plate's tag area
--    and refusing anything outside VISTA TRANSPORT.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_vehicle_cost_profile_save(
  p_tag_area_id uuid, p_purchase_price numeric, p_purchase_date date, p_model_year int,
  p_expected_life_km numeric, p_expected_life_years numeric, p_expected_resale_value numeric,
  p_depreciation_enabled boolean, p_tyre_cost numeric, p_tyre_life_km numeric,
  p_oil_change_cost numeric, p_oil_change_interval_km numeric, p_overhead_manual_monthly numeric
) returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_co uuid := auth_company_id(); v_ok boolean;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select exists(
    select 1 from acct_tag_areas ta join acct_tag_areas grp on grp.id = ta.parent_id
     where ta.id = p_tag_area_id and ta.company_id = v_co and ta.is_group = false and grp.name = 'VISTA TRANSPORT'
  ) into v_ok;
  if not v_ok then raise exception 'Not a VISTA TRANSPORT vehicle'; end if;

  insert into transport_vehicle_profiles(tag_area_id, company_id, purchase_price, purchase_date, model_year,
    expected_life_km, expected_life_years, expected_resale_value, depreciation_enabled, tyre_cost, tyre_life_km,
    oil_change_cost, oil_change_interval_km, overhead_manual_monthly)
  values (p_tag_area_id, v_co, p_purchase_price, p_purchase_date, p_model_year,
    p_expected_life_km, p_expected_life_years, p_expected_resale_value, coalesce(p_depreciation_enabled, true),
    p_tyre_cost, p_tyre_life_km, p_oil_change_cost, p_oil_change_interval_km, p_overhead_manual_monthly)
  on conflict (tag_area_id) do update set
    purchase_price = excluded.purchase_price, purchase_date = excluded.purchase_date, model_year = excluded.model_year,
    expected_life_km = excluded.expected_life_km, expected_life_years = excluded.expected_life_years,
    expected_resale_value = excluded.expected_resale_value, depreciation_enabled = excluded.depreciation_enabled,
    tyre_cost = excluded.tyre_cost, tyre_life_km = excluded.tyre_life_km,
    oil_change_cost = excluded.oil_change_cost, oil_change_interval_km = excluded.oil_change_interval_km,
    overhead_manual_monthly = excluded.overhead_manual_monthly, updated_at = now();
end $function$;
revoke all on function public.transport_vehicle_cost_profile_save(uuid, numeric, date, int, numeric, numeric, numeric, boolean, numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.transport_vehicle_cost_profile_save(uuid, numeric, date, int, numeric, numeric, numeric, boolean, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 5. THE ENGINE, rebuilt. Direct expense is no longer a free-text category
--    read off transport_expenses: it is every posted expense-account
--    journal line tagged to this plate's own tag area, grouped by the
--    account itself — the chart of accounts IS the breakdown now, not a
--    fixed fuel/oil/tyre/driver taxonomy this module invented. Depreciation
--    and fleet overhead are the only two "modeled" lines left, because
--    neither has a cash-posting equivalent in the ledger.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_vehicle_cost_model(
  p_company uuid, p_tag_area_id uuid, p_from date, p_to date,
  p_overrides jsonb default '{}'::jsonb   -- {maintenance_monthly, utilization_km, depreciation_enabled, overhead_method}
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
  r record;
begin
  select ta.name into v_tag_name
    from acct_tag_areas ta join acct_tag_areas grp on grp.id = ta.parent_id
   where ta.id = p_tag_area_id and ta.company_id = p_company and ta.is_group = false and grp.name = 'VISTA TRANSPORT';
  if v_tag_name is null then raise exception 'Vehicle not found (not a VISTA TRANSPORT plate)'; end if;

  select * into v_profile from transport_vehicle_profiles where tag_area_id = p_tag_area_id;

  v_months := greatest(1, extract(epoch from (p_to::timestamp - p_from::timestamp)) / 86400.0 / 30.4375);

  -- The driver(s) currently registered against this plate — trips carry
  -- driver_id, never a plate, so this is how a trip is matched back to it.
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

  -- Direct vehicle expenses: every POSTED expense-account journal line
  -- whose tag_area names this plate — whatever the account is. Replaces
  -- 389/390's fuel/oil/tyre/insurance/driver taxonomy entirely: if a driver
  -- salary or an iqama fee is posted against this van's tag area, it is
  -- this van's cost, exactly as the business tagged it. No inference, so
  -- the 390 double-count class of bug cannot recur here.
  for r in
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
    v_direct_monthly := v_direct_monthly + (r.amt / v_months);
    v_comp := v_comp || jsonb_build_array(jsonb_build_object(
      'key', 'acct_' || r.account_id, 'label', r.name, 'account_code', r.code,
      'monthly_cost', round(r.amt / v_months, 2),
      'cost_per_km', case when v_util_km > 0 then round((r.amt / v_months) / v_util_km, 4) end,
      'source', 'actual'));
  end loop;
  if v_direct_monthly = 0 then
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('key', 'direct_expenses', 'label', 'Direct Expenses (Chart of Accounts)',
      'monthly_cost', 0, 'cost_per_km', null, 'source', 'insufficient_data'));
  end if;

  -- Depreciation: unchanged formula, now keyed on the plate's own profile.
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

  -- Fleet overhead — unchanged source and method set; only which vehicles
  -- it is split across moves from the 8 categories to the 4 plates.
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

-- ────────────────────────────────────────────────────────────────────────
-- 6. Fleet overhead allocator — same pool, same six methods; "active
--    vehicles" and each vehicle's KM/revenue/active-days basis now come
--    from the 4 VISTA TRANSPORT plates (matched via driver registration)
--    instead of the 8 transport_vehicles categories.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_vehicle_overhead_share(
  p_company uuid, p_tag_area_id uuid, p_from date, p_to date, p_method text default null
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare
  v_method text := coalesce(p_method, get_setting('transport_costing_overhead_method', 'equal'));
  v_total numeric; v_active_n int; v_share numeric := 0; v_months numeric;
  v_veh_km numeric; v_fleet_km numeric;
  v_veh_rev numeric; v_fleet_rev numeric;
  v_veh_days int; v_fleet_days int;
  v_manual numeric;
  v_group_id uuid; v_tag_name text;
begin
  select id into v_group_id from acct_tag_areas where company_id = p_company and name = 'VISTA TRANSPORT' and is_group = true;
  select name into v_tag_name from acct_tag_areas where id = p_tag_area_id;

  v_months := greatest(1, extract(epoch from (p_to::timestamp - p_from::timestamp)) / 86400.0 / 30.4375);

  -- The ONLY source, unchanged from 389: transport_expenses rows tagged to
  -- neither a vehicle nor a driver, category 'admin_overhead'.
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
    select coalesce(sum(r.distance_km), 0) into v_veh_km
      from transport_trips t join transport_routes r on r.id = t.route_id
     where t.company_id = p_company and t.status = 'completed' and not coalesce(t.is_outsourced, false)
       and t.trip_date between p_from and p_to
       and t.driver_id in (select id from transport_drivers where company_id = p_company and vista_vehicle_reg = v_tag_name);
    select coalesce(sum(r.distance_km), 0) into v_fleet_km
      from transport_trips t join transport_routes r on r.id = t.route_id
      join transport_drivers d on d.id = t.driver_id
      join acct_tag_areas ta on ta.name = d.vista_vehicle_reg and ta.parent_id = v_group_id
     where t.company_id = p_company and t.status = 'completed' and not coalesce(t.is_outsourced, false)
       and t.trip_date between p_from and p_to;
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
-- 7. Historical sales comparison — trips matched via driver registration
--    instead of vehicle_id.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_sales_history(
  p_company uuid, p_tag_area_id uuid, p_route_id uuid, p_from date, p_to date, p_cost_per_km numeric
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_n int; v_lo numeric; v_hi numeric; v_avg numeric; v_med numeric; v_km numeric; v_tag_name text;
begin
  select r.distance_km into v_km from transport_routes r where r.id = p_route_id;
  select name into v_tag_name from acct_tag_areas where id = p_tag_area_id;
  select count(*), min(t.sell_rate), max(t.sell_rate), avg(t.sell_rate),
         percentile_cont(0.5) within group (order by t.sell_rate)
    into v_n, v_lo, v_hi, v_avg, v_med
    from transport_trips t
   where t.company_id = p_company and t.route_id = p_route_id
     and t.status = 'completed' and not coalesce(t.is_outsourced, false)
     and t.trip_date between p_from and p_to
     and t.driver_id in (select id from transport_drivers where company_id = p_company and vista_vehicle_reg = v_tag_name);

  if v_n is null or v_n = 0 then
    return jsonb_build_object('trips', 0, 'source', 'insufficient_data');
  end if;

  return jsonb_build_object(
    'trips', v_n, 'lowest', round(v_lo, 2), 'highest', round(v_hi, 2),
    'average', round(v_avg, 2), 'median', round(v_med, 2),
    'average_cost', round(coalesce(p_cost_per_km, 0) * coalesce(v_km, 0), 2),
    'average_profit', round(v_avg - coalesce(p_cost_per_km, 0) * coalesce(v_km, 0), 2),
    'average_margin_pct', case when v_avg > 0 then round(100.0 * (v_avg - coalesce(p_cost_per_km, 0) * coalesce(v_km, 0)) / v_avg, 1) end,
    'cost_basis', 'reconstructed_at_current_cost_per_km', 'source', 'historical');
end $function$;
revoke all on function public.transport_costing_sales_history(uuid, uuid, uuid, date, date, numeric) from public, anon;
grant execute on function public.transport_costing_sales_history(uuid, uuid, uuid, date, date, numeric) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 8. THE CALCULATOR — Mode 1. Same shape; p_vehicle_id is now a tag area id
--    (renamed p_tag_area_id), and a plate with no driver currently
--    registered against it gets an explicit warning rather than a silently
--    empty revenue/KM section.
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
      'trip_cost', v_trip_cost, 'pricing', v_pricing, 'historical_sales', v_sales,
      'confidence', v_model->'confidence', 'warnings', v_warnings, 'overrides_applied', p_overrides);
  end;
end $function$;
revoke all on function public.transport_costing_calculate(uuid, uuid, uuid, text, date, date, text, text, jsonb) from public, anon;
grant execute on function public.transport_costing_calculate(uuid, uuid, uuid, text, date, date, text, text, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 9. Mode 2 — Route Comparison: now loops the 4 VISTA TRANSPORT plates
--    instead of the 8 transport_vehicles categories, so every mode in this
--    module shows the same vehicle list, consistently.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_route_compare(
  p_company uuid, p_route_id uuid, p_period text, p_period_from date, p_period_to date
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_from date; v_to date; v_route transport_routes; v_rows jsonb := '[]'::jsonb; r record; v_model jsonb; v_group_id uuid;
begin
  select period_from, period_to into v_from, v_to from transport_costing_period_bounds(p_period, p_period_from, p_period_to);
  select * into v_route from transport_routes where id = p_route_id and company_id = p_company;
  if not found then raise exception 'Route not found'; end if;
  select id into v_group_id from acct_tag_areas where company_id = p_company and name = 'VISTA TRANSPORT' and is_group = true;

  for r in select id from acct_tag_areas where company_id = p_company and parent_id = v_group_id and is_group = false and is_active order by name loop
    v_model := transport_vehicle_cost_model(p_company, r.id, v_from, v_to, '{}'::jsonb);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'vehicle', v_model->'vehicle', 'cost_per_km', v_model->'cost_per_km',
      'trip_cost', round(coalesce((v_model->>'cost_per_km')::numeric, 0) * coalesce(v_route.distance_km, 0), 2),
      'monthly_km', v_model->'monthly_km', 'confidence', v_model->'confidence'));
  end loop;

  return jsonb_build_object('route', jsonb_build_object('id', v_route.id, 'name', v_route.name, 'distance_km', v_route.distance_km),
    'period', jsonb_build_object('label', p_period, 'from', v_from, 'to', v_to), 'vehicles', v_rows);
end $function$;
revoke all on function public.transport_costing_route_compare(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_costing_route_compare(uuid, uuid, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 10. Mode 3 — Vehicle Performance: revenue/trips/active-days matched via
--     driver registration instead of vehicle_id.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_vehicle_performance(
  p_company uuid, p_tag_area_id uuid, p_period text, p_period_from date, p_period_to date
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_from date; v_to date; v_model jsonb; v_revenue numeric; v_trips int; v_avg_trip numeric;
        v_active_days int; v_empty_pct numeric; v_tag_name text;
begin
  select period_from, period_to into v_from, v_to from transport_costing_period_bounds(p_period, p_period_from, p_period_to);
  v_model := transport_vehicle_cost_model(p_company, p_tag_area_id, v_from, v_to, '{}'::jsonb);
  select name into v_tag_name from acct_tag_areas where id = p_tag_area_id;

  select coalesce(sum(sell_rate), 0), count(*), count(distinct trip_date)
    into v_revenue, v_trips, v_active_days
    from transport_trips
   where company_id = p_company and status = 'completed' and not coalesce(is_outsourced, false)
     and trip_date between v_from and v_to
     and driver_id in (select id from transport_drivers where company_id = p_company and vista_vehicle_reg = v_tag_name);
  v_avg_trip := case when v_trips > 0 then round(v_revenue / v_trips, 2) end;

  select round(avg((transport_route_return_probability(p_company, rr.route_id, v_from, v_to)->>'historical_empty_return_pct')::numeric), 1)
    into v_empty_pct
    from (select distinct route_id from transport_trips
           where company_id = p_company and status = 'completed' and not coalesce(is_outsourced, false)
             and trip_date between v_from and v_to
             and driver_id in (select id from transport_drivers where company_id = p_company and vista_vehicle_reg = v_tag_name)) rr;

  return jsonb_build_object(
    'vehicle', v_model->'vehicle', 'period', jsonb_build_object('label', p_period, 'from', v_from, 'to', v_to),
    'total_km', v_model->'monthly_km', 'trips', v_trips,
    'revenue', round(v_revenue, 2), 'expenses', v_model->'monthly_total_cost',
    'cost_per_km', v_model->'cost_per_km',
    'revenue_per_km', case when (v_model->>'monthly_km')::numeric > 0 then round(v_revenue / (v_model->>'monthly_km')::numeric, 4) end,
    'profit', round(v_revenue - coalesce((v_model->>'monthly_total_cost')::numeric, 0), 2),
    'profit_per_km', case when (v_model->>'monthly_km')::numeric > 0
      then round((v_revenue - coalesce((v_model->>'monthly_total_cost')::numeric, 0)) / (v_model->>'monthly_km')::numeric, 4) end,
    'utilization_km', v_model->'monthly_km', 'active_days', v_active_days,
    'empty_return_pct', v_empty_pct, 'average_trip_value', v_avg_trip,
    'confidence', v_model->'confidence');
end $function$;
revoke all on function public.transport_costing_vehicle_performance(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_costing_vehicle_performance(uuid, uuid, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 11. Mode 4 — Route Profitability: an owned leg's cost is resolved via its
--     driver's registered plate; a trip whose driver has none registered
--     yet is counted in revenue but flagged, not silently costed at 0 or
--     guessed at a category average.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_route_profitability(
  p_company uuid, p_route_id uuid, p_period text, p_period_from date, p_period_to date
) returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_from date; v_to date; v_route transport_routes; v_hist jsonb;
        v_trips int; v_total_sell numeric; v_total_cost numeric := 0; v_km numeric;
        v_group_id uuid; v_tag_id uuid; v_unmatched int := 0;
        r record; v_model jsonb; v_veh_cpk_cache jsonb := '{}'::jsonb;
begin
  select period_from, period_to into v_from, v_to from transport_costing_period_bounds(p_period, p_period_from, p_period_to);
  select * into v_route from transport_routes where id = p_route_id and company_id = p_company;
  if not found then raise exception 'Route not found'; end if;
  v_hist := transport_route_return_probability(p_company, p_route_id, v_from, v_to);
  select id into v_group_id from acct_tag_areas where company_id = p_company and name = 'VISTA TRANSPORT' and is_group = true;

  select count(*), coalesce(sum(sell_rate), 0) into v_trips, v_total_sell
    from transport_trips where company_id = p_company and route_id = p_route_id and status = 'completed'
      and trip_date between v_from and v_to;

  for r in select id, driver_id, is_outsourced, vendor_cost from transport_trips
            where company_id = p_company and route_id = p_route_id and status = 'completed'
              and trip_date between v_from and v_to loop
    if coalesce(r.is_outsourced, false) then
      v_total_cost := v_total_cost + coalesce(r.vendor_cost, 0);
    else
      select ta.id into v_tag_id
        from transport_drivers d join acct_tag_areas ta on ta.name = d.vista_vehicle_reg and ta.parent_id = v_group_id
       where d.id = r.driver_id and d.company_id = p_company;
      if v_tag_id is null then
        v_unmatched := v_unmatched + 1;
      else
        if not (v_veh_cpk_cache ? v_tag_id::text) then
          v_model := transport_vehicle_cost_model(p_company, v_tag_id, v_from, v_to, '{}'::jsonb);
          v_veh_cpk_cache := v_veh_cpk_cache || jsonb_build_object(v_tag_id::text, coalesce((v_model->>'cost_per_km')::numeric, 0));
        end if;
        v_total_cost := v_total_cost + coalesce((v_veh_cpk_cache->>v_tag_id::text)::numeric, 0) * coalesce(v_route.distance_km, 0);
      end if;
    end if;
  end loop;

  v_km := coalesce(v_route.distance_km, 0) * v_trips;

  return jsonb_build_object(
    'route', jsonb_build_object('id', v_route.id, 'name', v_route.name, 'distance_km', v_route.distance_km),
    'period', jsonb_build_object('label', p_period, 'from', v_from, 'to', v_to),
    'trips', v_trips, 'total_km', round(v_km, 1),
    'average_selling_price', case when v_trips > 0 then round(v_total_sell / v_trips, 2) end,
    'average_cost', case when v_trips > 0 then round(v_total_cost / v_trips, 2) end,
    'average_profit', case when v_trips > 0 then round((v_total_sell - v_total_cost) / v_trips, 2) end,
    'average_margin_pct', case when v_total_sell > 0 then round(100.0 * (v_total_sell - v_total_cost) / v_total_sell, 1) end,
    'empty_return_pct', v_hist->'historical_empty_return_pct',
    'revenue_per_km', case when v_km > 0 then round(v_total_sell / v_km, 4) end,
    'cost_per_km', case when v_km > 0 then round(v_total_cost / v_km, 4) end,
    'profit_per_km', case when v_km > 0 then round((v_total_sell - v_total_cost) / v_km, 4) end,
    'unmatched_owned_trips', v_unmatched);
end $function$;
revoke all on function public.transport_costing_route_profitability(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_costing_route_profitability(uuid, uuid, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 12. Mode 5 — Fleet Overview: loops the 4 VISTA TRANSPORT plates.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_fleet_overview(p_company uuid, p_period text, p_period_from date, p_period_to date)
returns jsonb language plpgsql stable security invoker set search_path to 'public' as $function$
declare v_rows jsonb := '[]'::jsonb; r record; v_group_id uuid;
begin
  select id into v_group_id from acct_tag_areas where company_id = p_company and name = 'VISTA TRANSPORT' and is_group = true;
  for r in select id from acct_tag_areas where company_id = p_company and parent_id = v_group_id and is_group = false and is_active order by name loop
    v_rows := v_rows || jsonb_build_array(transport_costing_vehicle_performance(p_company, r.id, p_period, p_period_from, p_period_to));
  end loop;
  return jsonb_build_object('vehicles', v_rows);
end $function$;
revoke all on function public.transport_costing_fleet_overview(uuid, text, date, date) from public, anon;
grant execute on function public.transport_costing_fleet_overview(uuid, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 13. Save a snapshot — column renamed with the table (vehicle_id →
--     vehicle_tag_area_id), parameter renamed to match.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.transport_costing_snapshot_save(
  p_label text, p_tag_area_id uuid, p_route_id uuid, p_trip_type text, p_return_condition text,
  p_period_label text, p_period_from date, p_period_to date, p_result jsonb, p_selling_price numeric, p_overrides jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; v_co uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  insert into transport_costing_snapshots(company_id, created_by, label, vehicle_tag_area_id, route_id, trip_type,
    return_condition, period_label, period_from, period_to, result, selling_price, overrides)
  values (v_co, auth.uid(), p_label, p_tag_area_id, p_route_id, p_trip_type, p_return_condition,
    p_period_label, p_period_from, p_period_to, p_result, p_selling_price, coalesce(p_overrides, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $function$;
revoke all on function public.transport_costing_snapshot_save(text, uuid, uuid, text, text, text, date, date, jsonb, numeric, jsonb) from public, anon;
grant execute on function public.transport_costing_snapshot_save(text, uuid, uuid, text, text, text, date, date, jsonb, numeric, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 14. Self-verifying checks, against real production data plus rehearsals
--     that write and roll back.
-- ────────────────────────────────────────────────────────────────────────
do $chk$
declare v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
        v_group_id uuid; v_n int; v_plate uuid; v_model jsonb; v_route uuid; v_calc jsonb; v_snap uuid;
        v_n_before int; v_n_after int; v_dropped_cols int;
begin
  perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);

  -- VISTA TRANSPORT must resolve to exactly the 4 real plates.
  select id into v_group_id from acct_tag_areas where company_id = v_co and name = 'VISTA TRANSPORT' and is_group = true;
  if v_group_id is null then raise exception '391: VISTA TRANSPORT group not found'; end if;
  select count(*) into v_n from acct_tag_areas where company_id = v_co and parent_id = v_group_id and is_group = false and is_active;
  if v_n <> 4 then raise exception '391: expected 4 VISTA TRANSPORT plates, found %', v_n; end if;

  select count(*) into v_n from transport_vista_vehicles(v_co);
  if v_n <> 4 then raise exception '391: transport_vista_vehicles() returned % rows, expected 4', v_n; end if;

  -- The 11 profile columns must be gone from transport_vehicles.
  select count(*) into v_dropped_cols from information_schema.columns
   where table_name = 'transport_vehicles' and table_schema = 'public'
     and column_name in ('purchase_price', 'tyre_life_km', 'overhead_manual_monthly');
  if v_dropped_cols <> 0 then raise exception '391: cost-profile columns still on transport_vehicles'; end if;

  -- The engine must run for a real plate without error, honestly reporting
  -- no driver matched (nobody has entered vista_vehicle_reg yet) and no
  -- direct expenses (no voucher has been tagged to a plate yet).
  select id into v_plate from acct_tag_areas where company_id = v_co and parent_id = v_group_id and is_group = false order by sort limit 1;
  v_model := transport_vehicle_cost_model(v_co, v_plate, (current_date - interval '6 months')::date, current_date, '{}'::jsonb);
  if (v_model->'vehicle'->>'driver_matched')::boolean is distinct from false then
    raise exception '391: expected no driver matched yet (vista_vehicle_reg not populated), got %', v_model->'vehicle'->>'driver_matched';
  end if;
  if (v_model->>'trips')::int <> 0 then raise exception '391: expected 0 trips with no driver matched, got %', v_model->>'trips'; end if;
  if not exists (select 1 from jsonb_array_elements(v_model->'components') c where c->>'key' = 'direct_expenses' and c->>'source' = 'insufficient_data') then
    raise exception '391: expected an insufficient_data direct_expenses line with nothing posted yet';
  end if;

  -- A wrong id (not under VISTA TRANSPORT) must be refused.
  begin
    perform transport_vehicle_cost_model(v_co, (select id from transport_vehicles limit 1), current_date - 1, current_date, '{}'::jsonb);
    raise exception '391: cost model should have refused a transport_vehicles id';
  exception when others then
    if sqlerrm not ilike '%not found%' then raise; end if;
  end;

  -- Route Comparison and Fleet Overview must both enumerate exactly the 4 plates.
  select id into v_route from transport_routes where company_id = v_co and distance_km is not null limit 1;
  if v_route is not null then
    v_calc := transport_costing_route_compare(v_co, v_route, 'last_6_months', null, null);
    if jsonb_array_length(v_calc->'vehicles') <> 4 then
      raise exception '391: route_compare returned % vehicles, expected 4', jsonb_array_length(v_calc->'vehicles');
    end if;

    v_calc := transport_costing_calculate(v_co, v_plate, v_route, 'last_6_months', null, null, 'one_way', 'historical', '{}'::jsonb);
    if (v_calc->'route'->>'distance_km')::numeric <> (select distance_km from transport_routes where id = v_route) then
      raise exception '391: the calculator did not use the Route Master''s own distance';
    end if;
    if not exists (select 1 from jsonb_array_elements_text(v_calc->'warnings') w where w ilike 'NO DRIVER REGISTERED%') then
      raise exception '391: expected a NO DRIVER REGISTERED warning with vista_vehicle_reg unset';
    end if;
  end if;

  -- Vehicle Cost Profile rehearsal, now against a tag area id.
  perform transport_vehicle_cost_profile_save(v_plate, 120000, date '2025-01-01', 2025, 360000, null, 40000, true, 1200, 36000, 350, 4500, null);
  if not exists (select 1 from transport_vehicle_profiles where tag_area_id = v_plate and purchase_price = 120000 and tyre_life_km = 36000) then
    raise exception '391: the vehicle cost profile did not save';
  end if;
  perform transport_vehicle_cost_profile_save(v_plate, null, null, null, null, null, null, true, null, null, null, null, null);
  if exists (select 1 from transport_vehicle_profiles where tag_area_id = v_plate and purchase_price is not null) then
    raise exception '391: could not clear the cost profile back out';
  end if;
  -- Rejecting a non-VISTA-TRANSPORT tag area.
  begin
    perform transport_vehicle_cost_profile_save(
      (select id from acct_tag_areas where company_id = v_co and is_group = false and parent_id <> v_group_id limit 1),
      100, null, null, null, null, null, true, null, null, null, null, null);
    raise exception '391: cost profile save should have refused a non-VISTA-TRANSPORT tag area';
  exception when others then
    if sqlerrm <> 'Not a VISTA TRANSPORT vehicle' then raise; end if;
  end;

  -- Snapshot rehearsal against the renamed column.
  if v_route is not null then
    select count(*) into v_n_before from transport_costing_snapshots where company_id = v_co;
    begin
      v_snap := transport_costing_snapshot_save('391 rehearsal', v_plate, v_route, 'one_way', 'historical',
        'last_6_months', (current_date - interval '6 months')::date, current_date,
        jsonb_build_object('test', true), 999.99, '{}'::jsonb);
      if not exists (select 1 from transport_costing_snapshots where id = v_snap and vehicle_tag_area_id = v_plate and selling_price = 999.99) then
        raise exception '391: the saved snapshot did not read back what was saved';
      end if;
      raise exception 'ROLLBACK_REHEARSAL';
    exception when others then
      if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
    end;
    select count(*) into v_n_after from transport_costing_snapshots where company_id = v_co;
    if v_n_after <> v_n_before then raise exception '391: the snapshot rehearsal did not roll back'; end if;
  end if;

  raise notice '391 ok';
end $chk$;

commit;
