-- 173 Car Sales — Phase 3: Installment sale contracts + custom schedule.
--
-- The contract is the heart of the module: customer + vehicle + financials +
-- a fully CUSTOM (unequal) installment schedule. Hard rule enforced on save:
--   advance + sum(installments) = sale price (contract value).
-- One vehicle can have only one draft/active contract (no double-sell).
-- Activating a contract marks the vehicle sold and links customer + contract.
--
-- Installment paid_amount is updated by the receipts phase; status is derived.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

do $$ begin
  create type car_contract_status as enum ('draft','active','completed','cancelled');
exception when duplicate_object then null; end $$;

create sequence if not exists car_contract_seq;

create table if not exists car_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  contract_no text not null,
  customer_id uuid not null references parties(id) on delete restrict,
  vehicle_id uuid not null references car_vehicles(id) on delete restrict,
  contract_date date not null default current_date,
  start_date date,
  delivery_date date,
  expected_completion_date date,
  purchase_cost numeric(18,2) not null default 0,   -- snapshot of vehicle cost
  sale_price numeric(18,2) not null default 0,      -- installment selling price = contract value
  advance numeric(18,2) not null default 0,
  reference_name text,                              -- introducer / commission ref
  salesperson text,
  status car_contract_status not null default 'draft',
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  unique (company_id, contract_no)
);
create unique index if not exists car_one_active_contract_per_vehicle
  on car_contracts(vehicle_id) where status in ('draft','active');

alter table car_contracts enable row level security;
drop policy if exists car_contracts_staff on car_contracts;
create policy car_contracts_staff on car_contracts for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create table if not exists car_installments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references car_contracts(id) on delete cascade,
  inst_no int not null,
  due_date date not null,
  amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (contract_id, inst_no)
);
alter table car_installments enable row level security;
drop policy if exists car_installments_staff on car_installments;
create policy car_installments_staff on car_installments for all to authenticated
  using (exists (select 1 from car_contracts c where c.id = contract_id and c.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from car_contracts c where c.id = contract_id and c.company_id = auth_company_id() and is_staff()));

-- Derived per-installment status (no penalties — overdue is informational).
create or replace function public.car_installment_status(p_amount numeric, p_paid numeric, p_due date)
returns text language sql immutable as $$
  select case
    when coalesce(p_paid,0) >= coalesce(p_amount,0) and coalesce(p_amount,0) > 0 then 'paid'
    when coalesce(p_paid,0) > 0 and coalesce(p_paid,0) < coalesce(p_amount,0)
         then (case when p_due < current_date then 'overdue_partial' else 'partial' end)
    when p_due < current_date then 'overdue'
    else 'pending' end;
$$;

-- Save contract header + custom schedule (draft edits only). Enforces the
-- advance + sum(installments) = sale price rule.
create or replace function public.car_contract_save(p_id uuid, p_header jsonb, p_installments jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_company uuid := auth_company_id(); v_id uuid; v_no text;
  v_vehicle uuid := nullif(p_header->>'vehicle_id','')::uuid;
  v_sale numeric := coalesce(nullif(p_header->>'sale_price','')::numeric, 0);
  v_adv  numeric := coalesce(nullif(p_header->>'advance','')::numeric, 0);
  v_sched numeric; v_cost numeric; it jsonb; i int := 0; v_status car_contract_status;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if v_vehicle is null then raise exception 'Select a vehicle'; end if;
  if nullif(p_header->>'customer_id','') is null then raise exception 'Select a customer'; end if;

  v_sched := coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(p_installments,'[]'::jsonb)) e), 0);
  if round(v_adv + v_sched, 2) <> round(v_sale, 2) then
    raise exception 'Advance (%) + installments (%) = % but must equal the sale price % (difference %).',
      round(v_adv,2), round(v_sched,2), round(v_adv+v_sched,2), round(v_sale,2), round(v_sale-(v_adv+v_sched),2);
  end if;

  if p_id is null then
    -- guard double-sell (partial unique index also enforces it)
    if exists (select 1 from car_contracts where vehicle_id = v_vehicle and status in ('draft','active')) then
      raise exception 'This vehicle already has an active or draft contract.';
    end if;
    select total_cost into v_cost from car_vehicles where id = v_vehicle and company_id = v_company;
    v_no := 'CTR-' || lpad(nextval('car_contract_seq')::text, 6, '0');
    insert into car_contracts(company_id, contract_no, customer_id, vehicle_id, purchase_cost, created_by)
    values (v_company, v_no, (p_header->>'customer_id')::uuid, v_vehicle, coalesce(v_cost,0), auth.uid())
    returning id into v_id;
  else
    v_id := p_id;
    select status into v_status from car_contracts where id = v_id and company_id = v_company;
    if v_status is distinct from 'draft' then raise exception 'Only draft contracts can be edited here; use adjustments for an active contract.'; end if;
  end if;

  update car_contracts set
    customer_id  = (p_header->>'customer_id')::uuid,
    vehicle_id   = v_vehicle,
    contract_date = coalesce(nullif(p_header->>'contract_date','')::date, contract_date),
    delivery_date = nullif(p_header->>'delivery_date','')::date,
    sale_price   = v_sale,
    advance      = v_adv,
    reference_name = nullif(p_header->>'reference_name',''),
    salesperson  = nullif(p_header->>'salesperson',''),
    notes        = nullif(p_header->>'notes',''),
    updated_at   = now()
  where id = v_id and company_id = v_company;

  delete from car_installments where contract_id = v_id;
  for it in select * from jsonb_array_elements(coalesce(p_installments,'[]'::jsonb)) loop
    i := i + 1;
    insert into car_installments(contract_id, inst_no, due_date, amount, notes)
    values (v_id, i, (it->>'due_date')::date, coalesce(nullif(it->>'amount','')::numeric,0), nullif(it->>'notes',''));
  end loop;

  update car_contracts set expected_completion_date = (select max(due_date) from car_installments where contract_id = v_id)
  where id = v_id;

  -- reserve the vehicle + link customer while draft
  update car_vehicles set status = case when status = 'in_stock' then 'reserved' else status end,
    current_customer_id = (p_header->>'customer_id')::uuid, contract_id = v_id
  where id = v_vehicle and company_id = v_company;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when p_id is null then 'car_contract_created' else 'car_contract_updated' end,
          'car_contract', v_id, jsonb_build_object('sale_price', v_sale, 'advance', v_adv, 'installments', i));
  return v_id;
end $$;
revoke all on function public.car_contract_save(uuid, jsonb, jsonb) from anon;
grant execute on function public.car_contract_save(uuid, jsonb, jsonb) to authenticated;

-- Activate a contract (equivalent to posting the sale invoice): vehicle -> sold.
create or replace function public.car_contract_activate(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_vehicle uuid; v_min date;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update car_contracts set status = 'active',
    start_date = coalesce(start_date, (select min(due_date) from car_installments where contract_id = p_id), current_date),
    updated_at = now()
  where id = p_id and company_id = v_company and status = 'draft'
  returning vehicle_id into v_vehicle;
  if v_vehicle is null then raise exception 'Contract not found or not in draft.'; end if;
  update car_vehicles set status = case when status in ('in_stock','reserved') then 'sold' else status end where id = v_vehicle;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_contract_activated', 'car_contract', p_id, '{}'::jsonb);
end $$;
revoke all on function public.car_contract_activate(uuid) from anon;
grant execute on function public.car_contract_activate(uuid) to authenticated;

create or replace function public.car_contract_cancel(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_vehicle uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update car_contracts set status = 'cancelled', updated_at = now()
  where id = p_id and company_id = v_company and status in ('draft','active') returning vehicle_id into v_vehicle;
  if v_vehicle is null then raise exception 'Contract not found or not cancellable.'; end if;
  -- release the vehicle back to stock if it is not delivered/held
  update car_vehicles set status = case when status in ('reserved','sold') then 'in_stock' else status end,
    current_customer_id = null, contract_id = null
  where id = v_vehicle and status in ('reserved','sold');
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_contract_cancelled', 'car_contract', p_id, '{}'::jsonb);
end $$;
revoke all on function public.car_contract_cancel(uuid) from anon;
grant execute on function public.car_contract_cancel(uuid) to authenticated;

create or replace function public.car_contract_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_vehicle uuid; v_status car_contract_status;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select status, vehicle_id into v_status, v_vehicle from car_contracts where id = p_id and company_id = v_company;
  if not found then raise exception 'Contract not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft contracts can be deleted.'; end if;
  delete from car_contracts where id = p_id and company_id = v_company;
  update car_vehicles set status = case when status = 'reserved' then 'in_stock' else status end,
    current_customer_id = null, contract_id = null
  where id = v_vehicle and contract_id = p_id;
end $$;
revoke all on function public.car_contract_delete(uuid) from anon;
grant execute on function public.car_contract_delete(uuid) to authenticated;
