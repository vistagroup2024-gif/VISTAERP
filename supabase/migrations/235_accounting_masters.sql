-- 235_accounting_masters.sql
-- Accounting Phase 2 — Masters. New master tables behind the "Masters" group:
--   * Cost Center (with an optional sales target, used later in Phase 5)
--   * Tag Area
--   * Product Tree (hierarchical)
--   * Car Purchase Expense (heads added onto a car's cost)
-- Currencies already exist as a global table — add a base-conversion rate so the
-- Currencies master can hold FX rates (used later by multi-currency JV).
--
-- journal_lines already carries cost_center / tag_area text columns (migration
-- 200); these masters are the pick-lists that feed them.

alter table currencies add column if not exists rate_to_base numeric not null default 1;

create table if not exists acct_cost_centers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  code text,
  name text not null,
  sales_target numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists acct_tag_areas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists acct_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  parent_id uuid references acct_products(id) on delete set null,
  name text not null,
  is_group boolean not null default false,
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_acct_products_parent on acct_products(company_id, parent_id);

create table if not exists acct_car_purchase_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

-- RLS: staff of the company may read/write their own masters.
do $$
declare t text;
begin
  foreach t in array array['acct_cost_centers','acct_tag_areas','acct_products','acct_car_purchase_expenses'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_staff', t);
    execute format($p$create policy %I on %I for all to authenticated
      using (company_id = auth_company_id() and is_staff())
      with check (company_id = auth_company_id() and is_staff())$p$, t||'_staff', t);
  end loop;
end $$;
