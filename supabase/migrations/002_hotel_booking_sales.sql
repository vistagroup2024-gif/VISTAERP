-- ============================================================
-- VISTA ERP - 002 Hotel, Inventory Allotment, Packages,
-- Bookings, Sales Invoices (multi-currency)
-- ============================================================

-- ---------- Hotels & Rooms ----------
create type city_type as enum ('makkah','madinah','jeddah','other');

create table hotels (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  city        city_type not null default 'makkah',
  rating      int check (rating between 1 and 7),
  distance_haram_m int,
  supplier_id uuid references parties(id) on delete set null,
  address     text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table room_types (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  name        text not null,
  capacity    int not null default 2,
  created_at  timestamptz not null default now()
);

create table seasons (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now()
);

create table room_rates (
  id            uuid primary key default gen_random_uuid(),
  room_type_id  uuid not null references room_types(id) on delete cascade,
  season_id     uuid references seasons(id) on delete set null,
  currency      char(3) not null references currencies(code) default 'SAR',
  cost_price    numeric(18,2) not null default 0,
  sell_price    numeric(18,2) not null default 0,
  valid_from    date,
  valid_to      date,
  created_at    timestamptz not null default now()
);

-- ---------- Allotment (bulk-held inventory) ----------
create type allotment_status as enum ('active','released','expired');

create table allotments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_type_id  uuid not null references room_types(id) on delete cascade,
  season_id     uuid references seasons(id) on delete set null,
  rooms_held    int not null check (rooms_held >= 0),
  start_date    date not null,
  end_date      date not null,
  release_date  date,
  cost_price    numeric(18,2) not null default 0,
  currency      char(3) not null references currencies(code) default 'SAR',
  status        allotment_status not null default 'active',
  notes         text,
  created_at    timestamptz not null default now()
);

create index idx_allotments_hotel on allotments(hotel_id);

-- ---------- Packages ----------
create type service_type as enum ('hotel','transport','visa','air_ticket','other');
create type package_status as enum ('draft','active','archived');

create table packages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  name          text not null,
  code          text,
  description   text,
  duration_days int,
  base_currency char(3) not null references currencies(code) default 'PKR',
  status        package_status not null default 'draft',
  valid_from    date,
  valid_to      date,
  created_at    timestamptz not null default now()
);

create table package_items (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid not null references packages(id) on delete cascade,
  service_type  service_type not null,
  description   text not null,
  supplier_id   uuid references parties(id) on delete set null,
  hotel_id      uuid references hotels(id) on delete set null,
  room_type_id  uuid references room_types(id) on delete set null,
  qty           numeric(12,2) not null default 1,
  nights        int,
  cost_currency char(3) not null references currencies(code) default 'SAR',
  cost_price    numeric(18,2) not null default 0,
  sell_currency char(3) not null references currencies(code) default 'PKR',
  sell_price    numeric(18,2) not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_package_items_pkg on package_items(package_id);

-- ---------- Bookings ----------
create type booking_status as enum ('held','confirmed','traveled','closed','cancelled');

create table bookings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  branch_id       uuid references branches(id) on delete set null,
  booking_no      text not null,
  customer_id     uuid not null references parties(id),
  package_id      uuid references packages(id) on delete set null,
  travel_date     date,
  return_date     date,
  pax_count       int not null default 1,
  status          booking_status not null default 'held',
  sell_currency   char(3) not null references currencies(code) default 'PKR',
  fx_rate         numeric(18,6) not null default 1,
  total_cost      numeric(18,2) not null default 0,
  total_sell      numeric(18,2) not null default 0,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  unique (company_id, booking_no)
);

create index idx_bookings_customer on bookings(customer_id);
create index idx_bookings_status on bookings(status);

create table booking_pax (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id) on delete cascade,
  full_name     text not null,
  passport_no   text,
  passport_expiry date,
  nationality   text,
  dob           date,
  gender        text,
  visa_no       text,
  created_at    timestamptz not null default now()
);

create table booking_items (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id) on delete cascade,
  service_type  service_type not null,
  description   text not null,
  supplier_id   uuid references parties(id) on delete set null,
  hotel_id      uuid references hotels(id) on delete set null,
  allotment_id  uuid references allotments(id) on delete set null,
  qty           numeric(12,2) not null default 1,
  nights        int,
  cost_currency char(3) not null references currencies(code) default 'SAR',
  cost_price    numeric(18,2) not null default 0,
  sell_currency char(3) not null references currencies(code) default 'PKR',
  sell_price    numeric(18,2) not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_booking_items_booking on booking_items(booking_id);

-- ---------- Sales Invoices ----------
create type invoice_status as enum ('draft','issued','partially_paid','paid','void');

create table invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  invoice_no      text not null,
  booking_id      uuid references bookings(id) on delete set null,
  customer_id     uuid not null references parties(id),
  invoice_date    date not null default current_date,
  due_date        date,
  currency        char(3) not null references currencies(code) default 'PKR',
  fx_rate         numeric(18,6) not null default 1,
  subtotal        numeric(18,2) not null default 0,
  tax_rate        numeric(6,3) not null default 0,
  tax_amount      numeric(18,2) not null default 0,
  total           numeric(18,2) not null default 0,
  amount_paid     numeric(18,2) not null default 0,
  status          invoice_status not null default 'draft',
  einvoice_uuid   uuid,
  einvoice_qr     text,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (company_id, invoice_no)
);

create table invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id) on delete cascade,
  description   text not null,
  qty           numeric(12,2) not null default 1,
  unit_price    numeric(18,2) not null default 0,
  line_total    numeric(18,2) not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_invoices_customer on invoices(customer_id);
create index idx_invoice_lines_inv on invoice_lines(invoice_id);
