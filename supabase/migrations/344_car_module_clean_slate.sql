-- The Car module joins the clean slate.
--
-- DESTRUCTIVE. Companion to 343, and applied to production straight after it.
--
-- 343 cleared the general ledger but left car_contracts standing, on the
-- reasoning that a contract is operational rather than accounting. That was
-- wrong: /car-sales/contracts is the "Car Invoices" screen — the ERP's own name
-- for it — so it is an invoice, and clearing the books while leaving it behind
-- produced the worst of both. CI-000004 sat there "active" for 125,200 with a
-- 95,200 instalment schedule and no entry anywhere in the ledger to match.
--
-- WHAT GOES: 1 car invoice, its 12 instalments, 1 monthly service charge, and
-- the 1 vehicle. Backed up to _cleanup_343_car_* first, so this is reversible
-- alongside everything else 343 saved.
--
-- The service charge goes FIRST and by hand. car_service_charges.contract_id is
-- ON DELETE SET NULL, so deleting the invoice would not take the charge with it
-- — it would strand it on the Monthly Charges screen pointing at nothing.
--
-- Deletion goes through car_contract_delete and car_vehicle_delete rather than
-- a raw delete, because those routines are the module's own door: the contract
-- one unposts before deleting and releases the vehicle back to in_stock, and
-- going around them is how a half-deleted car is made. They require a staff
-- session, so this runs as one.
--
-- Nothing here touches an Umrah Group; the car module shares no table with it.

begin;

create table if not exists public._cleanup_343_car_contracts       as table car_contracts       with no data;
create table if not exists public._cleanup_343_car_installments    as table car_installments    with no data;
create table if not exists public._cleanup_343_car_service_charges as table car_service_charges with no data;
create table if not exists public._cleanup_343_car_vehicles        as table car_vehicles        with no data;

insert into public._cleanup_343_car_contracts       select * from car_contracts;
insert into public._cleanup_343_car_installments    select * from car_installments;
insert into public._cleanup_343_car_service_charges select * from car_service_charges;
insert into public._cleanup_343_car_vehicles        select * from car_vehicles;

alter table public._cleanup_343_car_contracts       enable row level security;
alter table public._cleanup_343_car_installments    enable row level security;
alter table public._cleanup_343_car_service_charges enable row level security;
alter table public._cleanup_343_car_vehicles        enable row level security;

do $do$
declare v_contract uuid; v_vehicle uuid; n int;
begin
  select id into v_contract from car_contracts limit 1;
  select id into v_vehicle  from car_vehicles  limit 1;

  delete from car_service_charge_payments;
  delete from car_service_charges;

  if v_contract is not null then perform car_contract_delete(v_contract); end if;  -- instalments cascade
  if v_vehicle  is not null then perform car_vehicle_delete(v_vehicle);  end if;

  select (select count(*) from car_contracts) + (select count(*) from car_installments)
       + (select count(*) from car_service_charges) + (select count(*) from car_vehicles) into n;
  if n <> 0 then
    raise exception '344: % row(s) remain across contracts/instalments/charges/vehicles', n;
  end if;
  if (select count(*) from _cleanup_343_car_contracts) = 0 then
    raise exception '344: the car_contracts backup is empty';
  end if;
end $do$;

insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
select c.id, auth.uid(), 'accounting_cleared', 'car_module', c.id,
       jsonb_build_object('car_contracts',       (select count(*) from _cleanup_343_car_contracts),
                          'car_installments',    (select count(*) from _cleanup_343_car_installments),
                          'car_service_charges', (select count(*) from _cleanup_343_car_service_charges),
                          'car_vehicles',        (select count(*) from _cleanup_343_car_vehicles),
                          'backup_prefix', '_cleanup_343_')
from companies c;

commit;
