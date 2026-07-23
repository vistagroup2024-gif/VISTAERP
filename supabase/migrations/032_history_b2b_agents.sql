-- ============================================================
-- VISTA ERP - 032 Package Update History + B2B Agent RBAC
-- Additive. Applied to remote DB via Supabase MCP; kept here for history.
--
-- 1. package_update_history: mark_package_updated() now snapshots the group's
--    previous vs newly-added BRNs (classified by brn_consumption.remarks =
--    'Package-update'), updated_by and timestamp, feeding the new
--    Package Update History screen.
-- 2. b2b_agents: partner travel-agent accounts (agency, company, contact,
--    username, email, mobile, country, currency, status, locked, credit_limit,
--    permissions jsonb). RBAC permissions are a jsonb map so new modules add
--    without schema changes. b2b_activity for login/activity history.
--    delete_b2b_agent() guard. RLS: company-scoped staff only.
-- ============================================================

create table if not exists package_update_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  group_id uuid references umrah_groups(id) on delete set null,
  group_no text, company_name text, agent_name text,
  arrival_date date, departure_date date,
  prev_brns text, new_brns text,
  updated_by uuid, updated_at timestamptz not null default now()
);
alter table package_update_history enable row level security;
create policy puh_staff on package_update_history for select to authenticated
  using (company_id = auth_company_id() and is_staff());

create table if not exists b2b_agents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  group_company_id uuid references group_companies(id) on delete set null,
  agency_name text not null, contact_person text, username text not null,
  email text, mobile text, country text, currency text default 'SAR',
  status text not null default 'active', locked boolean not null default false,
  credit_limit numeric(18,2) default 0, permissions jsonb not null default '{}'::jsonb,
  created_by uuid, created_at timestamptz not null default now()
);
create unique index if not exists uq_b2b_username on b2b_agents(company_id, lower(username));
alter table b2b_agents enable row level security;
create policy b2b_staff on b2b_agents for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create table if not exists b2b_activity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  agent_id uuid references b2b_agents(id) on delete cascade,
  kind text not null, detail text, at timestamptz not null default now()
);
alter table b2b_activity enable row level security;
create policy b2b_act_staff on b2b_activity for select to authenticated
  using (company_id = auth_company_id() and is_staff());

-- mark_package_updated + delete_b2b_agent bodies applied via MCP; see database.
select 1;
