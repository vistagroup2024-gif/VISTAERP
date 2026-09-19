-- Vehicle Transfer, as its own voucher, instead of the old three-step "open
-- the Car Invoice, open the contract, find the Lifecycle panel" route.
--
-- car_vehicle_transfer (migration 176) already did the one thing that
-- matters: it records the transfer and flips car_vehicles.ownership to
-- 'transferred', the one flag car_gen_charges_company() checks before
-- generating a future month, so Monthly Service Charges stop on their own
-- from there — nothing about that changes here. What was missing was a
-- quick way to reach it, and a way to see what the vehicle still owes
-- before you do, so transferring is a decision made with that in view, not
-- a guess. Nothing here settles or writes anything off; it only shows the
-- number. Settling it, if anything, still goes through an ordinary Receipt
-- Voucher, adjusted against the vehicle's own bills, same as any other
-- collection — the same "money questions read the ledger" rule as every
-- other balance this ERP shows.
--
-- car_transfer_candidates() is the picker: every Vista-owned vehicle that is
-- actually on a contract, the same population car_charges_month_load()
-- already draws its own candidates from, minus the month restriction (a
-- transfer isn't scoped to one month).
--
-- car_vehicle_transfer_load(p_vehicle) is the detail: the vehicle, its
-- contract and customer, and what it still owes — reusing
-- car_customer_vehicle_dues() (migration 454) rather than re-deriving the
-- outstanding figure a second way, so this screen and the Ageing Summary's
-- own per-vehicle drill-down can never disagree about what a car owes.

begin;

create or replace function public.car_transfer_candidates()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'vehicle_no', v.vehicle_no,
      'car', nullif(concat_ws(' ', v.make, v.model, v.model_year), ''),
      'plate_no', v.plate_no, 'customer', p.name
    ) order by v.vehicle_no), '[]'::jsonb)
    from car_vehicles v
    left join car_contracts ct on ct.id = v.contract_id
    left join parties p on p.id = ct.customer_id
   where v.company_id = auth_company_id()
     and is_staff() and staff_has_perm('carsales.ownership')
     and v.ownership = 'vista' and v.contract_id is not null;
$function$;
revoke all on function public.car_transfer_candidates() from public, anon;
grant execute on function public.car_transfer_candidates() to authenticated;

create or replace function public.car_vehicle_transfer_load(p_vehicle uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); veh car_vehicles%rowtype;
        v_contract_no text; v_customer_id uuid; v_customer text; v_dues jsonb; v_last jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not staff_has_perm('carsales.ownership') then raise exception 'No access to Vehicle Transfer'; end if;

  select * into veh from car_vehicles where id = p_vehicle and company_id = v_co;
  if not found then raise exception 'Vehicle not found'; end if;

  select ct.contract_no, ct.customer_id, p.name
    into v_contract_no, v_customer_id, v_customer
    from car_contracts ct left join parties p on p.id = ct.customer_id
   where ct.id = veh.contract_id;

  if v_customer_id is not null then
    select x into v_dues from jsonb_array_elements(
        coalesce(car_customer_vehicle_dues(v_customer_id) -> 'vehicles', '[]'::jsonb)) x
     where (x->>'contract_id')::uuid = veh.contract_id limit 1;
  end if;

  select jsonb_build_object('transfer_date', t.transfer_date, 'destination', t.destination,
           'reference', t.reference, 'notes', t.notes)
    into v_last
    from car_transfers t where t.vehicle_id = p_vehicle and t.company_id = v_co
   order by t.transfer_date desc, t.created_at desc limit 1;

  return jsonb_build_object(
    'vehicle_id', veh.id, 'vehicle_no', veh.vehicle_no,
    'car', nullif(concat_ws(' ', veh.make, veh.model, veh.model_year), ''),
    'plate_no', veh.plate_no, 'vin', veh.vin, 'ownership', veh.ownership,
    'contract_no', v_contract_no, 'customer', v_customer,
    'dues', coalesce(v_dues, jsonb_build_object(
        'installment_total', 0, 'installment_due', 0, 'installment_overdue', 0,
        'service_charge_total', 0, 'service_charge_due', 0, 'service_charge_overdue', 0,
        'total', 0, 'total_due', 0, 'total_overdue', 0)),
    'last_transfer', v_last);
end $function$;
revoke all on function public.car_vehicle_transfer_load(uuid) from public, anon;
grant execute on function public.car_vehicle_transfer_load(uuid) to authenticated;

do $chk$
declare v_bad int;
begin
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('car_transfer_candidates', 'car_vehicle_transfer_load')
     and (not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  if v_bad > 0 then raise exception '465: the transfer voucher routines are granted wrongly'; end if;
end $chk$;

commit;
