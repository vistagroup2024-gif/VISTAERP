-- 175 Car Sales — Phase 5: Monthly Service Charges (vehicle kept under Vista's name).
--
-- Vista charges a fixed monthly amount (default SAR 1,000) for every vehicle that
-- remains registered under Vista. Rules:
--   * starts from the vehicle's PURCHASE month
--   * charge month = e.g. Sep 2026; due date = 1st of the next month (01 Oct 2026)
--   * continues every month while ownership = 'vista' (even after the installment
--     contract is completed)
--   * stops once the vehicle is transferred out of Vista's name
--   * NO late penalty — overdue is informational only
-- This is a SEPARATE ledger from the car installments.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

alter table car_vehicles add column if not exists monthly_charge numeric(18,2) not null default 1000;

create table if not exists car_service_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  vehicle_id uuid not null references car_vehicles(id) on delete cascade,
  contract_id uuid references car_contracts(id) on delete set null,
  customer_id uuid references parties(id) on delete set null,
  charge_month date not null,                     -- first day of the charged month
  due_date date not null,                         -- first day of the following month
  amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (vehicle_id, charge_month)
);
alter table car_service_charges enable row level security;
drop policy if exists car_service_charges_staff on car_service_charges;
create policy car_service_charges_staff on car_service_charges for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create table if not exists car_service_charge_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references car_service_charges(id) on delete cascade,
  pay_date date not null default current_date,
  amount numeric(18,2) not null default 0,
  method text not null default 'cash',
  reference text,
  created_at timestamptz not null default now()
);
alter table car_service_charge_payments enable row level security;
drop policy if exists car_scharge_pay_staff on car_service_charge_payments;
create policy car_scharge_pay_staff on car_service_charge_payments for all to authenticated
  using (exists (select 1 from car_service_charges c where c.id = charge_id and c.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from car_service_charges c where c.id = charge_id and c.company_id = auth_company_id() and is_staff()));

-- Derived status (Pending / Due / Partially Paid / Paid / Overdue). No penalties.
create or replace function public.car_service_charge_status(p_amount numeric, p_paid numeric, p_due date)
returns text language sql immutable as $$
  select case
    when coalesce(p_paid,0) >= coalesce(p_amount,0) and coalesce(p_amount,0) > 0 then 'paid'
    when coalesce(p_paid,0) > 0 and coalesce(p_paid,0) < coalesce(p_amount,0) then 'partial'
    when p_due < current_date then 'overdue'
    when p_due <= current_date then 'due'
    else 'pending' end;
$$;

-- Generate all missing monthly charges up to (and including) the current month for
-- every Vista-owned vehicle with a purchase date. Idempotent (unique per month).
create or replace function public.car_generate_service_charges(p_asof date default current_date)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v rec; m date; v_end date; n int := 0;
  v_rec record;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_end := date_trunc('month', p_asof)::date;   -- charge current month once we've entered it
  for v_rec in
    select id, purchase_date, coalesce(monthly_charge,1000) as amt, current_customer_id, contract_id
    from car_vehicles
    where company_id = v_company and ownership = 'vista' and purchase_date is not null
  loop
    m := date_trunc('month', v_rec.purchase_date)::date;
    while m <= v_end loop
      insert into car_service_charges(company_id, vehicle_id, contract_id, customer_id, charge_month, due_date, amount)
      values (v_company, v_rec.id, v_rec.contract_id, v_rec.current_customer_id, m, (m + interval '1 month')::date, v_rec.amt)
      on conflict (vehicle_id, charge_month) do nothing;
      if found then n := n + 1; end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_service_charges_generated', 'car_service_charge', null, jsonb_build_object('created', n));
  return n;
end $$;
revoke all on function public.car_generate_service_charges(date) from anon;
grant execute on function public.car_generate_service_charges(date) to authenticated;

create or replace function public.car_scharge_recompute(p_charge uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update car_service_charges set paid_amount = coalesce((select sum(amount) from car_service_charge_payments where charge_id = p_charge), 0)
  where id = p_charge;
end $$;

-- Record a payment against a monthly service charge.
create or replace function public.car_scharge_pay(p_charge uuid, p_amount numeric, p_date date, p_method text, p_ref text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Enter a payment amount'; end if;
  if not exists (select 1 from car_service_charges where id = p_charge and company_id = v_company) then
    raise exception 'Charge not found'; end if;
  insert into car_service_charge_payments(charge_id, pay_date, amount, method, reference)
  values (p_charge, coalesce(p_date, current_date), p_amount, coalesce(nullif(p_method,''),'cash'), nullif(p_ref,''));
  perform car_scharge_recompute(p_charge);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_service_charge_paid', 'car_service_charge', p_charge, jsonb_build_object('amount', p_amount));
end $$;
revoke all on function public.car_scharge_pay(uuid, numeric, date, text, text) from anon;
grant execute on function public.car_scharge_pay(uuid, numeric, date, text, text) to authenticated;
