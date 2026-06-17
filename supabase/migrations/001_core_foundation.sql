-- ============================================================
-- VISTA ERP - 001 Core Foundation
-- Companies, Branches, Roles/Profiles, Currencies, FX, Parties
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
create type app_role as enum (
  'admin','accounting','hr','sales','purchase','inventory','hotel_ops','b2b_agent'
);

-- ---------- Companies / Branches ----------
create table companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  legal_name    text,
  base_currency char(3) not null default 'PKR',
  tax_number    text,
  address       text,
  phone         text,
  email         text,
  logo_url      text,
  einvoice_meta jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table branches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  code        text,
  address     text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- ---------- Profiles (linked to auth.users) ----------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid references companies(id) on delete set null,
  branch_id   uuid references branches(id) on delete set null,
  full_name   text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table user_roles (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      app_role not null,
  unique (user_id, role)
);

-- ---------- Currencies & Exchange Rates ----------
create table currencies (
  code      char(3) primary key,
  name      text not null,
  symbol    text,
  is_active boolean not null default true
);

insert into currencies(code,name,symbol) values
  ('PKR','Pakistani Rupee','Rs'),
  ('SAR','Saudi Riyal','SAR'),
  ('USD','US Dollar','$'),
  ('AED','UAE Dirham','AED');

create table exchange_rates (
  id            uuid primary key default gen_random_uuid(),
  from_currency char(3) not null references currencies(code),
  to_currency   char(3) not null references currencies(code),
  rate          numeric(18,6) not null check (rate > 0),
  rate_date     date not null default current_date,
  created_at    timestamptz not null default now(),
  unique (from_currency, to_currency, rate_date)
);

-- ---------- Parties: Suppliers & Customers/Agents ----------
create type party_type as enum ('customer','supplier','b2b_agent');

create table parties (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  party_type    party_type not null,
  name          text not null,
  code          text,
  email         text,
  phone         text,
  address       text,
  tax_number    text,
  currency      char(3) references currencies(code),
  credit_limit  numeric(18,2) default 0,
  portal_user_id uuid references auth.users(id) on delete set null,
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now()
);

create index idx_parties_company on parties(company_id);
create index idx_parties_type on parties(party_type);

-- ---------- Document numbering sequences ----------
create table doc_sequences (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  doc_type    text not null,
  prefix      text not null default '',
  next_number bigint not null default 1,
  padding     int not null default 5,
  unique (company_id, doc_type)
);
