-- 258_car_autocharge_on_contract.sql
-- Monthly service-charge invoices generate automatically when a Car Invoice
-- (installment contract) becomes active — in addition to the existing 1st-of-
-- month cron (car_gen_charges_company). Only for vehicles still in Vista's name
-- (ownership = 'vista'); once a vehicle is transferred, ownership changes and no
-- further charges generate. Idempotent (on conflict do nothing).

create or replace function car_gen_charges_vehicle(
  p_vehicle uuid, p_asof date default current_date,
  p_contract uuid default null, p_customer uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare m date; v_end date; n int := 0; v car_vehicles%rowtype;
begin
  select * into v from car_vehicles
    where id = p_vehicle and ownership = 'vista' and purchase_date is not null;
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

create or replace function car_contract_autocharge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Fire when the contract becomes active (a real Car Invoice). Exception-safe:
  -- never block the contract write.
  if new.status = 'active' and coalesce(old.status::text, '') is distinct from 'active' then
    begin
      perform car_gen_charges_vehicle(new.vehicle_id, current_date, new.id, new.customer_id);
    exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists trg_car_contract_autocharge on car_contracts;
create trigger trg_car_contract_autocharge after insert or update on car_contracts
  for each row execute function car_contract_autocharge();

grant execute on function car_gen_charges_vehicle(uuid, date, uuid, uuid) to authenticated;
