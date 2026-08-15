-- 171 Car Sales on Installment — Phase 1: vehicle inventory (master record).
--
-- A vehicle is ONE master record for its whole lifecycle (never duplicated).
-- Purchase info lives on the vehicle for Phase 1; the formal Purchase Order /
-- Voucher flow (Phase 2) will populate the same fields. Sale/contract/delivery/
-- transfer records (later phases) link back to this row.
--
-- Ownership (vista/transferred) is tracked separately from stock status, because
-- a vehicle can be sold, delivered and fully paid while still registered to Vista.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

do $$ begin
  create type car_vehicle_status as enum
    ('ordered','in_stock','reserved','sold','delivered','held','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type car_ownership_status as enum ('vista','transferred');
exception when duplicate_object then null; end $$;

create sequence if not exists car_vehicle_seq;

create table if not exists car_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  vehicle_no text not null,                       -- CAR-000001
  vin text,                                       -- VIN / chassis
  plate_no text,
  make text, model text, variant text,
  model_year int, color text, engine_no text,
  -- purchase
  purchase_date date,
  supplier_id uuid references parties(id) on delete set null,
  purchase_cost numeric(18,2) not null default 0,
  purchase_vat  numeric(18,2) not null default 0,
  total_cost numeric(18,2) generated always as (coalesce(purchase_cost,0) + coalesce(purchase_vat,0)) stored,
  current_location text,
  -- lifecycle
  status car_vehicle_status not null default 'in_stock',
  ownership car_ownership_status not null default 'vista',
  current_customer_id uuid references parties(id) on delete set null,
  contract_id uuid,                               -- FK added in Phase 3
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  unique (company_id, vehicle_no)
);

alter table car_vehicles enable row level security;
drop policy if exists car_vehicles_staff on car_vehicles;
create policy car_vehicles_staff on car_vehicles for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

-- Create / update a vehicle master record.
create or replace function public.car_vehicle_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_id uuid; v_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then
    v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
    insert into car_vehicles(company_id, vehicle_no, created_by) values (v_company, v_no, auth.uid())
      returning id into v_id;
  else
    v_id := p_id;
  end if;

  update car_vehicles set
    vin           = nullif(p->>'vin',''),
    plate_no      = nullif(p->>'plate_no',''),
    make          = nullif(p->>'make',''),
    model         = nullif(p->>'model',''),
    variant       = nullif(p->>'variant',''),
    model_year    = nullif(p->>'model_year','')::int,
    color         = nullif(p->>'color',''),
    engine_no     = nullif(p->>'engine_no',''),
    purchase_date = nullif(p->>'purchase_date','')::date,
    supplier_id   = nullif(p->>'supplier_id','')::uuid,
    purchase_cost = coalesce(nullif(p->>'purchase_cost','')::numeric, 0),
    purchase_vat  = coalesce(nullif(p->>'purchase_vat','')::numeric, 0),
    current_location = nullif(p->>'current_location',''),
    status        = coalesce(nullif(p->>'status','')::car_vehicle_status, status),
    ownership     = coalesce(nullif(p->>'ownership','')::car_ownership_status, ownership),
    notes         = nullif(p->>'notes',''),
    updated_at    = now()
  where id = v_id and company_id = v_company;
  if not found then raise exception 'Vehicle not found'; end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when p_id is null then 'car_vehicle_created' else 'car_vehicle_updated' end,
          'car_vehicle', v_id, jsonb_build_object('vehicle_no', (select vehicle_no from car_vehicles where id = v_id)));
  return v_id;
end $$;
revoke all on function public.car_vehicle_save(uuid, jsonb) from anon;
grant execute on function public.car_vehicle_save(uuid, jsonb) to authenticated;

-- Delete a vehicle (only while still un-sold; sold/delivered/held vehicles are locked).
create or replace function public.car_vehicle_delete(p_vehicle uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_status car_vehicle_status;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select status into v_status from car_vehicles where id = p_vehicle and company_id = v_company;
  if not found then raise exception 'Vehicle not found'; end if;
  if v_status in ('reserved','sold','delivered','held') then
    raise exception 'This vehicle is % and cannot be deleted.', v_status;
  end if;
  delete from car_vehicles where id = p_vehicle and company_id = v_company;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_vehicle_deleted', 'car_vehicle', p_vehicle, '{}'::jsonb);
end $$;
revoke all on function public.car_vehicle_delete(uuid) from anon;
grant execute on function public.car_vehicle_delete(uuid) to authenticated;
