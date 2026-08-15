-- 174 Car Sales — Phase 4: Receipts with EXPLICIT per-installment allocation.
--
-- A receipt is money collected against a contract. The collector chooses exactly
-- which installment(s) each amount pays — money is NEVER auto-applied to the
-- oldest installment. Partial payments are supported (installment.paid_amount can
-- be less than its amount). Editing a receipt reverses its old allocations first.
-- When every installment is fully paid the contract auto-completes; if a later
-- edit reopens a balance it returns to active.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

create sequence if not exists car_receipt_seq;

create table if not exists car_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  receipt_no text not null,
  contract_id uuid not null references car_contracts(id) on delete cascade,
  customer_id uuid references parties(id) on delete set null,
  receipt_date date not null default current_date,
  amount numeric(18,2) not null default 0,
  method text not null default 'cash',            -- cash | bank | card | transfer
  reference text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, receipt_no)
);
alter table car_receipts enable row level security;
drop policy if exists car_receipts_staff on car_receipts;
create policy car_receipts_staff on car_receipts for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create table if not exists car_receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references car_receipts(id) on delete cascade,
  target_type text not null default 'installment', -- installment | advance
  installment_id uuid references car_installments(id) on delete cascade,
  amount numeric(18,2) not null default 0
);
alter table car_receipt_allocations enable row level security;
drop policy if exists car_receipt_alloc_staff on car_receipt_allocations;
create policy car_receipt_alloc_staff on car_receipt_allocations for all to authenticated
  using (exists (select 1 from car_receipts r where r.id = receipt_id and r.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from car_receipts r where r.id = receipt_id and r.company_id = auth_company_id() and is_staff()));

-- Recompute installment.paid_amount for a contract from its allocations.
create or replace function public.car_recompute_installments(p_contract uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update car_installments ins set paid_amount = coalesce((
    select sum(a.amount) from car_receipt_allocations a
    where a.installment_id = ins.id and a.target_type = 'installment'), 0)
  where ins.contract_id = p_contract;

  update car_contracts c set status = case
    when c.status = 'active'
         and exists (select 1 from car_installments i where i.contract_id = p_contract)
         and not exists (select 1 from car_installments i where i.contract_id = p_contract and i.paid_amount < i.amount)
      then 'completed'
    when c.status = 'completed'
         and exists (select 1 from car_installments i where i.contract_id = p_contract and i.paid_amount < i.amount)
      then 'active'
    else c.status end,
    updated_at = now()
  where c.id = p_contract;
end $$;

-- Save a receipt + its explicit allocations. Reverses prior allocations on edit.
create or replace function public.car_receipt_save(p_id uuid, p_header jsonb, p_allocs jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_company uuid := auth_company_id(); v_id uuid; v_no text;
  v_contract uuid := nullif(p_header->>'contract_id','')::uuid;
  v_amount numeric := coalesce(nullif(p_header->>'amount','')::numeric, 0);
  v_alloc_total numeric; a jsonb; v_cust uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if v_contract is null then raise exception 'Select a contract'; end if;
  if v_amount <= 0 then raise exception 'Enter a receipt amount'; end if;

  v_alloc_total := coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(p_allocs,'[]'::jsonb)) e), 0);
  if round(v_alloc_total, 2) > round(v_amount, 2) then
    raise exception 'Allocated (%) exceeds the receipt amount (%).', round(v_alloc_total,2), round(v_amount,2);
  end if;

  select customer_id into v_cust from car_contracts where id = v_contract and company_id = v_company;
  if not found then raise exception 'Contract not found'; end if;

  if p_id is null then
    v_no := 'RCP-' || lpad(nextval('car_receipt_seq')::text, 6, '0');
    insert into car_receipts(company_id, receipt_no, contract_id, customer_id, created_by)
    values (v_company, v_no, v_contract, v_cust, auth.uid()) returning id into v_id;
  else
    v_id := p_id;
    delete from car_receipt_allocations where receipt_id = v_id;  -- reverse old
  end if;

  update car_receipts set
    contract_id = v_contract, customer_id = v_cust,
    receipt_date = coalesce(nullif(p_header->>'receipt_date','')::date, current_date),
    amount = v_amount,
    method = coalesce(nullif(p_header->>'method',''), 'cash'),
    reference = nullif(p_header->>'reference',''),
    notes = nullif(p_header->>'notes','')
  where id = v_id and company_id = v_company;

  for a in select * from jsonb_array_elements(coalesce(p_allocs,'[]'::jsonb)) loop
    if coalesce(nullif(a->>'amount','')::numeric,0) <> 0 then
      insert into car_receipt_allocations(receipt_id, target_type, installment_id, amount)
      values (v_id, coalesce(nullif(a->>'target_type',''),'installment'),
              nullif(a->>'installment_id','')::uuid, (a->>'amount')::numeric);
    end if;
  end loop;

  perform car_recompute_installments(v_contract);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when p_id is null then 'car_receipt_created' else 'car_receipt_updated' end,
          'car_receipt', v_id, jsonb_build_object('amount', v_amount, 'allocated', v_alloc_total));
  return v_id;
end $$;
revoke all on function public.car_receipt_save(uuid, jsonb, jsonb) from anon;
grant execute on function public.car_receipt_save(uuid, jsonb, jsonb) to authenticated;

create or replace function public.car_receipt_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_contract uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select contract_id into v_contract from car_receipts where id = p_id and company_id = v_company;
  if not found then raise exception 'Receipt not found'; end if;
  delete from car_receipts where id = p_id and company_id = v_company;  -- cascades allocations
  perform car_recompute_installments(v_contract);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_receipt_deleted', 'car_receipt', p_id, '{}'::jsonb);
end $$;
revoke all on function public.car_receipt_delete(uuid) from anon;
grant execute on function public.car_receipt_delete(uuid) to authenticated;
