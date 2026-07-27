-- ============================================================
-- VISTA ERP - 045 Transport Management Module (foundation schema)
-- Applied to remote DB via Supabase MCP; kept here for history.
-- Full schema for the whole TMS (masters + booking + trips) so later phases
-- (booking, ops, scheduling, vouchers, reports) need no redesign. Phase 1
-- wires up the Masters UI only. All tables are company-scoped, staff-only RLS,
-- mirroring group_companies.
-- ============================================================

create table if not exists transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  category text, name text not null, vehicle_type text,
  seating_capacity int, luggage_capacity text, image text,
  is_active boolean not null default true, sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists transport_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null, from_location text, to_location text,
  distance_km numeric, driving_minutes int, rest_minutes int not null default 0,
  is_active boolean not null default true, created_at timestamptz not null default now()
);

create table if not exists transport_route_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  route_id uuid not null references transport_routes(id) on delete cascade,
  vehicle_id uuid not null references transport_vehicles(id) on delete cascade,
  sell_rate numeric not null default 0, currency text not null default 'SAR',
  is_active boolean not null default true, created_at timestamptz not null default now(),
  unique (route_id, vehicle_id)
);

create table if not exists transport_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null, package_type text not null default 'without_ziyarat',
  duration_days int, vehicle_id uuid references transport_vehicles(id) on delete set null,
  price numeric not null default 0, currency text not null default 'SAR',
  is_active boolean not null default true, created_at timestamptz not null default now()
);

create table if not exists transport_package_legs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  package_id uuid not null references transport_packages(id) on delete cascade,
  seq int not null default 0, route_id uuid references transport_routes(id) on delete set null,
  label text, vehicle_id uuid references transport_vehicles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists transport_drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null, iqama text, license_no text, mobile text,
  vehicle_id uuid references transport_vehicles(id) on delete set null,
  languages text[] not null default '{}', status text not null default 'active',
  emergency_contact text, iqama_expiry date, license_expiry date,
  shift_start time, shift_end time, notes text,
  created_at timestamptz not null default now()
);

create table if not exists transport_bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  booking_no text, booking_type text not null default 'single',
  status text not null default 'draft', agent_id uuid,
  group_company_id uuid references group_companies(id) on delete set null,
  package_id uuid references transport_packages(id) on delete set null,
  booking_date date, pax int, passenger_name text, primary_contact text,
  mobile text, whatsapp text, nationality text, remarks text,
  arrival_flight text, arrival_date date, arrival_time time,
  departure_flight text, departure_date date, departure_time time,
  sell_amount numeric not null default 0, discount numeric not null default 0,
  additional_charges numeric not null default 0, net_amount numeric not null default 0,
  total_amount numeric not null default 0, currency text not null default 'SAR',
  created_by uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transport_trips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  booking_id uuid not null references transport_bookings(id) on delete cascade,
  seq int not null default 0, route_id uuid references transport_routes(id) on delete set null,
  route_label text, vehicle_id uuid references transport_vehicles(id) on delete set null,
  driver_id uuid references transport_drivers(id) on delete set null,
  trip_date date, trip_time time, pickup_location text, drop_location text,
  sell_rate numeric not null default 0, status text not null default 'pending',
  scheduled_start timestamptz, scheduled_end timestamptz, assigned_at timestamptz,
  remarks text, created_at timestamptz not null default now()
);

create index if not exists idx_tr_vehicles_company on transport_vehicles(company_id);
create index if not exists idx_tr_routes_company on transport_routes(company_id);
create index if not exists idx_tr_rates_route on transport_route_rates(route_id);
create index if not exists idx_tr_rates_vehicle on transport_route_rates(vehicle_id);
create index if not exists idx_tr_packages_company on transport_packages(company_id);
create index if not exists idx_tr_pkglegs_package on transport_package_legs(package_id);
create index if not exists idx_tr_drivers_company on transport_drivers(company_id);
create index if not exists idx_tr_bookings_company on transport_bookings(company_id);
create index if not exists idx_tr_bookings_date on transport_bookings(booking_date);
create index if not exists idx_tr_trips_booking on transport_trips(booking_id);
create index if not exists idx_tr_trips_date on transport_trips(trip_date);
create index if not exists idx_tr_trips_driver on transport_trips(driver_id);
create index if not exists idx_tr_trips_vehicle on transport_trips(vehicle_id);

-- RLS: staff-only, company-scoped (mirrors group_companies)
do $$
declare t text;
begin
  foreach t in array array[
    'transport_vehicles','transport_routes','transport_route_rates',
    'transport_packages','transport_package_legs','transport_drivers',
    'transport_bookings','transport_trips'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_staff', t);
    execute format(
      'create policy %I on %I for all to authenticated using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff())',
      t||'_staff', t);
  end loop;
end $$;
