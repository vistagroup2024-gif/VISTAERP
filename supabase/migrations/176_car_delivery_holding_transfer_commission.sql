-- 176 Car Sales — Phase 6: Delivery, Holding, Transfer, Commission + status automation.
--
-- * Delivery: record handover; vehicle -> delivered.
-- * Holding: if a customer falls ~2 months overdue Vista may keep the vehicle.
--   This does NOT cancel the contract — it stays active, balances stay live.
--   vehicle -> held; release returns it to sold/delivered.
-- * Transfer: the vehicle actually leaves Vista's name -> ownership = transferred,
--   which STOPS future Monthly Service Charges (generation skips non-vista).
--   Historical charges are preserved.
-- * Commission: optional per-deal introducer commission (fixed or %).
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

-- Delivery -----------------------------------------------------------------
create table if not exists car_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  vehicle_id uuid not null references car_vehicles(id) on delete cascade,
  contract_id uuid references car_contracts(id) on delete set null,
  delivery_date date not null default current_date,
  odometer int,
  delivered_by text,
  acknowledged_by text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table car_deliveries enable row level security;
drop policy if exists car_deliveries_staff on car_deliveries;
create policy car_deliveries_staff on car_deliveries for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- Holding ------------------------------------------------------------------
create table if not exists car_holdings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  vehicle_id uuid not null references car_vehicles(id) on delete cascade,
  contract_id uuid references car_contracts(id) on delete set null,
  held_date date not null default current_date,
  reason text,
  agreement_notes text,
  released_at date,
  release_notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table car_holdings enable row level security;
drop policy if exists car_holdings_staff on car_holdings;
create policy car_holdings_staff on car_holdings for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- Transfer -----------------------------------------------------------------
create table if not exists car_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  vehicle_id uuid not null references car_vehicles(id) on delete cascade,
  contract_id uuid references car_contracts(id) on delete set null,
  transfer_date date not null default current_date,
  destination text,
  reference text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table car_transfers enable row level security;
drop policy if exists car_transfers_staff on car_transfers;
create policy car_transfers_staff on car_transfers for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- Commission ---------------------------------------------------------------
create table if not exists car_commissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  contract_id uuid not null references car_contracts(id) on delete cascade,
  reference_name text,
  comm_type text not null default 'fixed',        -- fixed | percentage
  comm_value numeric(18,2) not null default 0,
  amount numeric(18,2) not null default 0,
  paid boolean not null default false,
  paid_date date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (contract_id)
);
alter table car_commissions enable row level security;
drop policy if exists car_commissions_staff on car_commissions;
create policy car_commissions_staff on car_commissions for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- RPCs ---------------------------------------------------------------------
create or replace function public.car_vehicle_deliver(p_contract uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_vehicle uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select vehicle_id into v_vehicle from car_contracts where id = p_contract and company_id = v_company;
  if v_vehicle is null then raise exception 'Contract not found'; end if;
  insert into car_deliveries(company_id, vehicle_id, contract_id, delivery_date, odometer, delivered_by, acknowledged_by, notes)
  values (v_company, v_vehicle, p_contract, coalesce(nullif(p->>'delivery_date','')::date, current_date),
          nullif(p->>'odometer','')::int, nullif(p->>'delivered_by',''), nullif(p->>'acknowledged_by',''), nullif(p->>'notes',''));
  update car_vehicles set status = 'delivered' where id = v_vehicle and status in ('sold','reserved','held');
  update car_contracts set delivery_date = coalesce(nullif(p->>'delivery_date','')::date, current_date) where id = p_contract;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_vehicle_delivered', 'car_contract', p_contract, '{}'::jsonb);
end $$;
revoke all on function public.car_vehicle_deliver(uuid, jsonb) from anon;
grant execute on function public.car_vehicle_deliver(uuid, jsonb) to authenticated;

create or replace function public.car_vehicle_hold(p_contract uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_vehicle uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select vehicle_id into v_vehicle from car_contracts where id = p_contract and company_id = v_company;
  if v_vehicle is null then raise exception 'Contract not found'; end if;
  insert into car_holdings(company_id, vehicle_id, contract_id, held_date, reason, agreement_notes)
  values (v_company, v_vehicle, p_contract, coalesce(nullif(p->>'held_date','')::date, current_date), nullif(p->>'reason',''), nullif(p->>'agreement_notes',''));
  update car_vehicles set status = 'held' where id = v_vehicle;   -- contract stays active
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_vehicle_held', 'car_contract', p_contract, '{}'::jsonb);
end $$;
revoke all on function public.car_vehicle_hold(uuid, jsonb) from anon;
grant execute on function public.car_vehicle_hold(uuid, jsonb) to authenticated;

create or replace function public.car_vehicle_release(p_vehicle uuid, p_notes text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_delivered boolean;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update car_holdings set released_at = current_date, release_notes = nullif(p_notes,'')
  where vehicle_id = p_vehicle and released_at is null
    and company_id = v_company;
  select exists(select 1 from car_deliveries where vehicle_id = p_vehicle and company_id = v_company) into v_delivered;
  update car_vehicles set status = case when v_delivered then 'delivered' else 'sold' end
  where id = p_vehicle and company_id = v_company and status = 'held';
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_vehicle_released', 'car_vehicle', p_vehicle, '{}'::jsonb);
end $$;
revoke all on function public.car_vehicle_release(uuid, text) from anon;
grant execute on function public.car_vehicle_release(uuid, text) to authenticated;

create or replace function public.car_vehicle_transfer(p_vehicle uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_contract uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from car_vehicles where id = p_vehicle and company_id = v_company) then raise exception 'Vehicle not found'; end if;
  select contract_id into v_contract from car_vehicles where id = p_vehicle;
  insert into car_transfers(company_id, vehicle_id, contract_id, transfer_date, destination, reference, notes)
  values (v_company, p_vehicle, v_contract, coalesce(nullif(p->>'transfer_date','')::date, current_date),
          nullif(p->>'destination',''), nullif(p->>'reference',''), nullif(p->>'notes',''));
  -- Ownership leaves Vista -> future Monthly Service Charges stop (generation skips non-vista).
  update car_vehicles set ownership = 'transferred' where id = p_vehicle and company_id = v_company;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_vehicle_transferred', 'car_vehicle', p_vehicle, '{}'::jsonb);
end $$;
revoke all on function public.car_vehicle_transfer(uuid, jsonb) from anon;
grant execute on function public.car_vehicle_transfer(uuid, jsonb) to authenticated;

create or replace function public.car_commission_save(p_contract uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_type text; v_val numeric; v_amount numeric; v_sale numeric;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select sale_price into v_sale from car_contracts where id = p_contract and company_id = v_company;
  if not found then raise exception 'Contract not found'; end if;
  v_type := coalesce(nullif(p->>'comm_type',''),'fixed');
  v_val := coalesce(nullif(p->>'comm_value','')::numeric, 0);
  v_amount := case when v_type = 'percentage' then round(coalesce(v_sale,0) * v_val / 100, 2) else v_val end;
  insert into car_commissions(company_id, contract_id, reference_name, comm_type, comm_value, amount, paid, paid_date, notes)
  values (v_company, p_contract, nullif(p->>'reference_name',''), v_type, v_val, v_amount,
          coalesce((p->>'paid')::boolean,false), nullif(p->>'paid_date','')::date, nullif(p->>'notes',''))
  on conflict (contract_id) do update set
    reference_name = excluded.reference_name, comm_type = excluded.comm_type, comm_value = excluded.comm_value,
    amount = excluded.amount, paid = excluded.paid, paid_date = excluded.paid_date, notes = excluded.notes;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_commission_saved', 'car_contract', p_contract, jsonb_build_object('amount', v_amount));
end $$;
revoke all on function public.car_commission_save(uuid, jsonb) from anon;
grant execute on function public.car_commission_save(uuid, jsonb) to authenticated;
