-- A customer owing money is a report question of "for what" — which car's
-- instalment, which month's service charge, or (rarely) something billed to
-- them outside the car module entirely. Car Customer Balances' Ageing
-- Summary only ever showed the customer TOTAL; a customer with two or three
-- vehicles had no way to see which one the balance actually belonged to.
--
-- car_customer_vehicle_dues(p_customer_id) is the drill-down: one row per
-- car_contracts row (vehicle) the customer holds, each carrying its own
-- Due/Overdue/Total split into the car-invoice side (advance + instalments)
-- and the service-charge side, plus an 'other' bucket for anything posted
-- to the account outside car_sale/car_installment/car_scharge_month.
--
-- The car-invoice side matches a bill back to its own contract through
-- doc_no (car_contract_bills_raise's own '<contract_no>/<n>' /
-- '<contract_no> advance' shape — the only link open_items carries; a
-- contract's bills always parse back to exactly that one contract, so this
-- is exact, not an approximation).
--
-- The service-charge side cannot be that precise: car_post_charges_month
-- raises ONE bill per customer per month, summing every vehicle's charge
-- for that month into it (a two-vehicle customer's two charges share one
-- bill), so open_items alone cannot say which vehicle a partial payment
-- against that bill actually covers. A vehicle's own share of what's still
-- outstanding is taken as its share of that month's total, applied to the
-- bill's own remaining balance (car_service_charges.amount * bill's
-- outstanding/billed ratio) — exact for the (common) single-vehicle
-- customer, a fair proportional split otherwise. Same "money questions
-- read the ledger" rule as everywhere else in this report: nothing here is
-- car_service_charges.paid_amount, which — like car_installments.paid_amount
-- before it — is only ever updated by the car module's own receipt flow and
-- would silently miss a plain, bill-wise-adjusted Receipt Voucher the same
-- way 453 just fixed at the customer level.
create or replace function public.car_customer_vehicle_dues(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with co as (select auth_company_id() as id),
  acct as (
    select a.id as account_id from accounts a
     where a.party_id = p_customer_id and a.company_id = (select id from co) limit 1
  ),
  bounds as (select date_trunc('month', current_date)::date as month_start, current_date as today),
  cars as (
    select c.id, c.contract_no, c.status,
           trim(both ' ' from coalesce(v.model_year::text,'') || ' ' || coalesce(v.make,'') || ' ' || coalesce(v.model,'')) as vehicle,
           v.plate_no
      from car_contracts c
      left join car_vehicles v on v.id = c.vehicle_id
     where c.customer_id = p_customer_id and c.company_id = (select id from co)
  ),
  car_bills as (
    select split_part(regexp_replace(o.doc_no, '\s+advance$', ''), '/', 1) as contract_no,
           o.due_date, o.outstanding_base
      from open_items o
     where o.account_id = (select account_id from acct) and o.status = 'open'
       and o.doc_type in ('car_sale', 'car_installment')
  ),
  car_due as (
    select cars.id as contract_id,
      coalesce(sum(b.outstanding_base) filter (where b.due_date < (select month_start from bounds)), 0) as overdue,
      coalesce(sum(b.outstanding_base) filter (where b.due_date >= (select month_start from bounds)
                                                  and b.due_date <= (select today from bounds)), 0) as due,
      coalesce(sum(b.outstanding_base), 0) as total
    from cars
    left join car_bills b on b.contract_no = cars.contract_no
    group by cars.id
  ),
  sc_bills as (
    select o.due_date, o.amount_base, o.outstanding_base
      from open_items o
     where o.account_id = (select account_id from acct) and o.status = 'open'
       and o.doc_type = 'car_scharge_month'
  ),
  sc_rows as (
    select s.contract_id, s.due_date,
      s.amount * case when b.amount_base > 0 then b.outstanding_base / b.amount_base else 0 end as outstanding
    from car_service_charges s
    join sc_bills b on b.due_date = s.due_date
    where s.customer_id = p_customer_id and s.company_id = (select id from co)
  ),
  sc_due as (
    select contract_id,
      coalesce(sum(outstanding) filter (where due_date < (select month_start from bounds)), 0) as overdue,
      coalesce(sum(outstanding) filter (where due_date >= (select month_start from bounds)
                                          and due_date <= (select today from bounds)), 0) as due,
      coalesce(sum(outstanding), 0) as total
    from sc_rows group by contract_id
  ),
  other_bills as (
    select
      coalesce(sum(outstanding_base) filter (where due_date < (select month_start from bounds)), 0) as overdue,
      coalesce(sum(outstanding_base) filter (where due_date >= (select month_start from bounds)
                                                and due_date <= (select today from bounds)), 0) as due,
      coalesce(sum(outstanding_base), 0) as total
    from open_items o
   where o.account_id = (select account_id from acct) and o.status = 'open'
     and o.doc_type not in ('car_sale', 'car_installment', 'car_scharge_month')
  )
  select jsonb_build_object(
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object(
        'contract_id', cars.id, 'contract_no', cars.contract_no, 'vehicle', cars.vehicle,
        'plate_no', cars.plate_no, 'status', cars.status,
        'installment_due', coalesce(cd.due,0), 'installment_overdue', coalesce(cd.overdue,0),
        'installment_total', coalesce(cd.total,0),
        'service_charge_due', coalesce(sd.due,0), 'service_charge_overdue', coalesce(sd.overdue,0),
        'service_charge_total', coalesce(sd.total,0),
        'total_due', coalesce(cd.due,0) + coalesce(sd.due,0),
        'total_overdue', coalesce(cd.overdue,0) + coalesce(sd.overdue,0),
        'total', coalesce(cd.total,0) + coalesce(sd.total,0)
      ) order by cars.contract_no) from cars
      left join car_due cd on cd.contract_id = cars.id
      left join sc_due sd on sd.contract_id = cars.id), '[]'::jsonb),
    'other', (select jsonb_build_object('due', due, 'overdue', overdue, 'total', total) from other_bills)
  );
$function$;

revoke all on function public.car_customer_vehicle_dues(uuid) from public, anon;
grant execute on function public.car_customer_vehicle_dues(uuid) to authenticated;
