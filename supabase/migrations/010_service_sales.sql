-- ============================================================
-- VISTA ERP - 010 Service Sales (catalog, per-customer rates,
-- flexible bookings, visa tracking)
-- ============================================================

create type visa_status as enum ('pending','applied','issued','rejected');

create table service_catalog (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  code          text,
  name          text not null,
  service_type  service_type not null default 'visa',
  default_cost  numeric(18,2) not null default 0,
  cost_currency char(3) not null references currencies(code) default 'SAR',
  list_price    numeric(18,2) not null default 0,
  sell_currency char(3) not null references currencies(code) default 'PKR',
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now()
);
create index idx_service_catalog_company on service_catalog(company_id);

create table customer_rates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  party_id    uuid not null references parties(id) on delete cascade,
  service_id  uuid not null references service_catalog(id) on delete cascade,
  price       numeric(18,2) not null default 0,
  currency    char(3) not null references currencies(code) default 'PKR',
  created_at  timestamptz not null default now(),
  unique (party_id, service_id)
);
create index idx_customer_rates_party on customer_rates(party_id);

alter table bookings      add column if not exists category text;
alter table booking_items add column if not exists service_id uuid references service_catalog(id) on delete set null;
alter table booking_pax   add column if not exists visa_type text;
alter table booking_pax   add column if not exists visa_status visa_status not null default 'pending';

create or replace function get_service_price(p_party uuid, p_service uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select price from customer_rates where party_id = p_party and service_id = p_service),
    (select list_price from service_catalog where id = p_service),
    0
  );
$$;

alter table service_catalog enable row level security;
alter table customer_rates  enable row level security;

create policy service_catalog_staff on service_catalog for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());
create policy service_catalog_agent_read on service_catalog for select to authenticated
  using (is_active and has_role('b2b_agent'));
create policy customer_rates_staff on customer_rates for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());
create policy customer_rates_agent_read on customer_rates for select to authenticated
  using (party_id = auth_party_id());

revoke all on function get_service_price(uuid,uuid) from anon;
grant execute on function get_service_price(uuid,uuid) to authenticated;

insert into service_catalog(company_id, code, name, service_type, default_cost, cost_currency, list_price, sell_currency) values
  ('96f6b539-b491-4df7-91a2-80c7c8e7491d','SVC-VISA','Umrah Visa','visa',300,'SAR',35000,'PKR'),
  ('96f6b539-b491-4df7-91a2-80c7c8e7491d','SVC-TRANS-INT','Intercity Transport (Makkah-Madinah-Jeddah)','transport',250,'SAR',18000,'PKR'),
  ('96f6b539-b491-4df7-91a2-80c7c8e7491d','SVC-TRANS-APT','Airport Transfer','transport',80,'SAR',6000,'PKR'),
  ('96f6b539-b491-4df7-91a2-80c7c8e7491d','SVC-AIR','Return Air Ticket (LHE-JED-LHE)','air_ticket',450,'USD',130000,'PKR'),
  ('96f6b539-b491-4df7-91a2-80c7c8e7491d','SVC-ZIYARAT','Ziyarat Tour','ziyarat',100,'SAR',8000,'PKR'),
  ('96f6b539-b491-4df7-91a2-80c7c8e7491d','SVC-INS','Travel Insurance','insurance',20,'USD',3500,'PKR');
