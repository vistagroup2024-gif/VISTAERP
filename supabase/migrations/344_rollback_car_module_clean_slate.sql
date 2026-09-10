-- ROLLBACK for 344: restores the car invoice, its instalments, the monthly
-- service charge and the vehicle from the backups 344 took.
--
-- The vehicle goes back first: car_contracts.vehicle_id is ON DELETE RESTRICT,
-- so the contract cannot exist without it. Instalments and charges follow the
-- contract for the same reason.

begin;

do $g$ begin
  if to_regclass('public._cleanup_343_car_contracts') is null then
    raise exception '344 rollback: the backup tables are gone — nothing to restore from'; end if;
end $g$;

insert into car_vehicles        select * from public._cleanup_343_car_vehicles        on conflict do nothing;
insert into car_contracts       select * from public._cleanup_343_car_contracts       on conflict do nothing;
insert into car_installments    select * from public._cleanup_343_car_installments    on conflict do nothing;
insert into car_service_charges select * from public._cleanup_343_car_service_charges on conflict do nothing;

do $chk$ begin
  if (select count(*) from car_contracts) <> (select count(*) from public._cleanup_343_car_contracts)
  then raise exception '344 rollback: contract count does not match the backup'; end if;
end $chk$;

commit;
