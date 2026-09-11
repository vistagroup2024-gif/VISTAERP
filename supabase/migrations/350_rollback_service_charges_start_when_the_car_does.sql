-- Undo 350. Puts back the old behaviour: charges generated from the vehicle's
-- PURCHASE date rather than from the delivery, no proration of the first month,
-- and one journal entry per charge rather than one voucher a month.
--
-- Two things to know before running it.
--
-- Charges already generated are NOT deleted. Rows created under the new rule —
-- including the half-month ones — stay, and the old generator will simply add
-- the months it thinks are missing (everything back to the purchase date). If
-- that is not wanted, delete the charges first and let it rebuild.
--
-- Monthly vouchers already posted are NOT unposted, and the restored
-- car_sync_company will post every charge AGAIN, individually, under a
-- different key — so each charge would be counted twice in the ledger. Unpost
-- the car_scharge_month entries before running this if any exist.

begin;

drop function if exists public.car_post_charges_month(uuid, date);
drop function if exists public.car_charge_for_month(date, date, numeric);

create or replace function public.car_gen_charges_company(p_company uuid, p_asof date default current_date)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare m date; v_end date; n int := 0; v_rec record;
begin
  v_end := date_trunc('month', p_asof)::date;
  for v_rec in
    select id, purchase_date, coalesce(monthly_charge,1000) as amt, current_customer_id, contract_id
    from car_vehicles where company_id = p_company and ownership = 'vista' and purchase_date is not null
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
end $function$;

create or replace function public.car_monthly_run(p_secret text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare c uuid; v_companies int := 0; v_charges int := 0; v_posted int := 0;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  for c in select distinct company_id from car_vehicles loop
    v_companies := v_companies + 1;
    v_charges := v_charges + car_gen_charges_company(c);
    v_posted := v_posted + car_sync_company(c);
  end loop;
  return jsonb_build_object('companies', v_companies, 'charges_created', v_charges, 'journals_posted', v_posted);
end $function$;
revoke all on function public.car_monthly_run(text) from public;
grant execute on function public.car_monthly_run(text) to anon, authenticated;

-- NOTE: car_sync_company's service-charge loop is deliberately NOT restored
-- here. It debited a control account under the same key car_post_charge uses,
-- so which account a charge landed in depended on call order. Restoring it
-- would bring that back AND double-post alongside any monthly voucher already
-- raised. Put it back by hand if that behaviour is genuinely wanted.

commit;
