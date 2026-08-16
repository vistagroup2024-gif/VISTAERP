-- Phase B: per-room pricing, option dates, and manual payment states.
--
-- Each stay (hotel_purchase_bookings) can now hold multiple independent rooms,
-- each with its own room type, meal plan and DBL + extra-bed rates (sale AND
-- purchase); suites carry a manual suite type + flat rate. Bed math (TPL=DBL+1x,
-- Quad=+2x, Quint=+3x extra) is computed client-side; the stay's sale_rate/
-- sale_total/purchase_rate/purchase_total are the rolled-up nightly + line totals.
--
-- Also: customer "option date" (payment due / last date) per stay, the vendor's
-- own option date captured when a supplier is attached, and manual Vendor / Customer
-- payment status labels (pending / partial / paid|rcvd).

-- 1. New stay-level columns.
alter table hotel_purchase_bookings add column if not exists option_date        date;
alter table hotel_purchase_bookings add column if not exists vendor_option_date date;
alter table hotel_purchase_bookings add column if not exists vendor_payment     text not null default 'pending';
alter table hotel_purchase_bookings add column if not exists customer_payment   text not null default 'pending';

-- 2. Per-room breakdown table.
create table if not exists hotel_stay_rooms (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default auth_company_id(),
  booking_id    uuid not null references hotel_bookings(id) on delete cascade,
  stay_id       uuid not null references hotel_purchase_bookings(id) on delete cascade,
  sort          integer not null default 0,
  room_type     text not null default 'dbl',
  meal_plan     text,
  suite_type    text,
  sale_dbl      numeric not null default 0,
  sale_extra    numeric not null default 0,
  sale_suite    numeric not null default 0,
  purchase_dbl  numeric not null default 0,
  purchase_extra numeric not null default 0,
  purchase_suite numeric not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists hotel_stay_rooms_stay_idx on hotel_stay_rooms(stay_id);
create index if not exists hotel_stay_rooms_booking_idx on hotel_stay_rooms(booking_id);

alter table hotel_stay_rooms enable row level security;
drop policy if exists hotel_stay_rooms_staff on hotel_stay_rooms;
create policy hotel_stay_rooms_staff on hotel_stay_rooms
  using ((company_id = auth_company_id()) and is_staff())
  with check ((company_id = auth_company_id()) and is_staff());
revoke all on hotel_stay_rooms from anon;
