-- 259_pv_creates_vehicle.sql
-- A posted Purchase Voucher whose cost center is a car cost center creates a
-- vehicle in Car Sales stock (details are completed on the stock record):
--   'CAR SALES INSTALLMENT' -> vehicle retained in Vista's name, sold on
--        installment; gets monthly service charges while in our name.
--   'CAR TRADING'           -> a trading vehicle (is_trading); NO monthly
--        service charges.
-- Also excludes trading vehicles from monthly-charge generation (cron + the
-- on-contract trigger from 258).

alter table car_vehicles add column if not exists is_trading boolean not null default false;
alter table car_vehicles add column if not exists source_trade_doc uuid;

-- Create a stock vehicle from a posted car Purchase Voucher (idempotent per doc).
create or replace function car_vehicle_from_trade_doc(p_doc uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d trade_documents; v_cc text; v_id uuid; v_no text;
begin
  select * into d from trade_documents where id = p_doc;
  if not found then return null; end if;
  if d.doc_type <> 'purchase_voucher' then return null; end if;
  v_cc := upper(btrim(coalesce(d.cost_center, '')));
  if v_cc not in ('CAR SALES INSTALLMENT', 'CAR TRADING') then return null; end if;
  select id into v_id from car_vehicles where source_trade_doc = p_doc;
  if v_id is not null then return v_id; end if;

  v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
  insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
    ownership, is_trading, status, notes, source_trade_doc)
  values (d.company_id, v_no, d.party_id, d.doc_date, coalesce(d.total, 0),
    'vista', v_cc = 'CAR TRADING', 'in_stock',
    'Created from Purchase Voucher ' || coalesce(d.doc_no, ''), p_doc)
  returning id into v_id;
  return v_id;
end $$;

-- Fire when a trade document becomes posted (gl_entry set). Exception-safe.
create or replace function car_pv_vehicle_autocreate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.gl_entry is not null and coalesce(old.gl_entry, '00000000-0000-0000-0000-000000000000'::uuid) is distinct from new.gl_entry
     and new.doc_type = 'purchase_voucher'
     and upper(btrim(coalesce(new.cost_center,''))) in ('CAR SALES INSTALLMENT','CAR TRADING') then
    begin perform car_vehicle_from_trade_doc(new.id); exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists trg_car_pv_vehicle_autocreate on trade_documents;
create trigger trg_car_pv_vehicle_autocreate after insert or update on trade_documents
  for each row execute function car_pv_vehicle_autocreate();

grant execute on function car_vehicle_from_trade_doc(uuid) to authenticated;

-- Exclude trading vehicles from monthly service-charge generation (company cron).
create or replace function public.car_gen_charges_company(p_company uuid, p_asof date default current_date)
returns int language plpgsql security definer set search_path to 'public' as $$
declare m date; v_end date; n int := 0; v_rec record;
begin
  v_end := date_trunc('month', p_asof)::date;
  for v_rec in
    select id, purchase_date, coalesce(monthly_charge,1000) as amt, current_customer_id, contract_id
    from car_vehicles where company_id = p_company and ownership = 'vista'
      and not coalesce(is_trading, false) and purchase_date is not null
  loop
    m := date_trunc('month', v_rec.purchase_date)::date;
    while m <= v_end loop
      insert into car_service_charges(company_id, vehicle_id, contract_id, customer_id, charge_month, due_date, amount)
      values (p_company, v_rec.id, v_rec.contract_id, v_rec.current_customer_id, m, (m + interval '1 month')::date, v_rec.amt)
      on conflict (vehicle_id, charge_month) do nothing;
      if found then n := n + 1; end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  return n;
end $$;

-- Same exclusion for the per-vehicle generator (from 258).
create or replace function car_gen_charges_vehicle(
  p_vehicle uuid, p_asof date default current_date,
  p_contract uuid default null, p_customer uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare m date; v_end date; n int := 0; v car_vehicles%rowtype;
begin
  select * into v from car_vehicles
    where id = p_vehicle and ownership = 'vista' and not coalesce(is_trading, false) and purchase_date is not null;
  if not found then return 0; end if;
  v_end := date_trunc('month', p_asof)::date;
  m := date_trunc('month', v.purchase_date)::date;
  while m <= v_end loop
    insert into car_service_charges(company_id, vehicle_id, contract_id, customer_id, charge_month, due_date, amount)
    values (v.company_id, v.id, coalesce(p_contract, v.contract_id), coalesce(p_customer, v.current_customer_id),
            m, (m + interval '1 month')::date, coalesce(v.monthly_charge, 1000))
    on conflict (vehicle_id, charge_month) do nothing;
    if found then n := n + 1; end if;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $$;
