-- Car Customer Balances' due/overdue/collected, its Monthwise/monthly-
-- receipts columns, and the per-customer report's own chart all read
-- car_installments.paid_amount / car_contracts.advance / car_receipts — a
-- SECOND, parallel ledger of what a car customer owes and has paid, kept in
-- sync only by car_receipt_save's own two branches (installment collection,
-- and the advance-on-Sale-Order tab) and by car_post_receipt's trigger.
--
-- open_items/allocations is already the real, canonical bill ledger for
-- these same amounts — car_contract_bills_raise (387) raises one bill per
-- instalment plus the advance, car_post_charges_month raises one per month
-- of service charges, and "Every invoice is a bill the receipt can adjust
-- against" already means ANY voucher — not only a Car Receipt — can settle
-- one, through the ordinary Receipt/Payment/Journal bill-wise popup.
--
-- A receipt taken that way (a plain Receipt Voucher, the customer's account
-- picked as the line, adjusted against the bill in the popup) posts
-- correctly to the ledger and correctly to open_items/allocations — but
-- never touches car_receipts or car_installments.paid_amount, since it
-- never runs through car_receipt_save. So it vanished from this screen
-- entirely: due/overdue/collected stayed at the pre-receipt figures, and
-- the Monthwise chart's own receipt column read zero for a month real money
-- came in. Reproduced live: ABDUL JALAL (CI-000005) had two such receipts,
-- SAR 15,000 total, correctly posted and correctly bill-adjusted (the
-- advance bill's own outstanding dropped from 20,000 to 5,000) — and this
-- screen still read collected: 0, overdue: 20,000, total_due: 28,583.34.
--
-- Fixed by reading open_items directly instead of the shadow figures:
--   - car_customer_balances(): due_items sums open_items.outstanding_base
--     (doc_type car_sale/car_installment/car_scharge_month), keyed on
--     open_items.party_id. 'collected' is amount_base - outstanding_base,
--     true regardless of which voucher settled it.
--   - car_customer_monthwise(): due_by_month the same way; receipts_by_month
--     now sums allocations.amount_base joined through open_items to the
--     settling journal_entries.entry_date — the month money actually
--     posted, not car_receipts.receipt_date.
--   - car_customer_report(): only its month_pts CTE changes, to the same
--     open_items/allocations reading, applying the SAME period-shift rule
--     (451: a recurring instalment/charge due on the 1st is FOR the
--     preceding month) by doc_type, since item_base already carries it and
--     the rest of the function (ageing/by_type/bills) already read
--     open_items and were never affected by this bug.
--
-- Neither function drops car_receipts / car_installments / car_receipt_
-- allocations — car_receipt_settle_bills, the PaymentPanel's installment
-- collection UI and the Car Receipt screens still read and write them for
-- their own per-installment allocation detail. Only these three read-side
-- aggregates move onto the ledger-true source, the same "money questions
-- read the ledger" rule this file states everywhere else.

create or replace function public.car_customer_balances()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with
    co as (select auth_company_id() as id),
    bounds as (
      select date_trunc('month', current_date)::date as month_start, current_date as today
    ),
    due_items as (
      select o.party_id as customer_id, o.due_date as due,
             o.outstanding_base as amt, (o.amount_base - o.outstanding_base) as paid
        from open_items o
       where o.company_id = (select id from co) and o.status = 'open'
         and o.doc_type in ('car_sale', 'car_installment', 'car_scharge_month')
    ),
    per_customer as (
      select customer_id,
        coalesce(sum(amt) filter (where due < (select month_start from bounds)), 0) as overdue,
        coalesce(sum(amt) filter (where due >= (select month_start from bounds)
                                    and due <= (select today from bounds)), 0) as due_this_month,
        coalesce(sum(paid), 0) as collected
      from due_items group by customer_id
    ),
    contracts as (
      select customer_id, count(*) as cars,
             coalesce(sum(net_payable), 0) as value, coalesce(sum(advance), 0) as advance
        from car_contracts
       where company_id = (select id from co) and status <> 'cancelled' and customer_id is not null
       group by customer_id
    ),
    bal as (
      select a.party_id as customer_id, coalesce(sum(l.debit - l.credit), 0) as balance
        from accounts a
        join journal_lines l on l.account_id = a.id
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
       where a.company_id = (select id from co) and a.party_id is not null
       group by a.party_id
    )
  select coalesce(jsonb_agg(jsonb_build_object(
      'customer_id', p.id, 'name', p.name, 'phone', p.phone,
      'cars', ct.cars, 'value', ct.value, 'advance', ct.advance,
      'due', coalesce(pc.due_this_month, 0), 'overdue', coalesce(pc.overdue, 0),
      'total_due', coalesce(pc.due_this_month, 0) + coalesce(pc.overdue, 0),
      'collected', coalesce(pc.collected, 0), 'balance', coalesce(b.balance, 0)
    ) order by coalesce(b.balance, 0) desc), '[]'::jsonb)
  from parties p
  join contracts ct on ct.customer_id = p.id
  left join per_customer pc on pc.customer_id = p.id
  left join bal b on b.customer_id = p.id;
$function$;

create or replace function public.car_customer_monthwise(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with bounds as (
  select date_trunc('month', current_date)::date as m0,
         (date_trunc('month', current_date) - interval '1 month')::date as m1,
         (date_trunc('month', current_date) - interval '2 month')::date as m2,
         (date_trunc('month', current_date) - interval '3 month')::date as m3
),
due_by_month as (
  select o.party_id as customer_id, date_trunc('month', o.due_date)::date as mth, sum(o.outstanding_base) as amt
    from open_items o
   where o.company_id = p_company and o.status = 'open'
     and o.doc_type in ('car_sale', 'car_installment', 'car_scharge_month')
   group by 1, 2
),
receipts_by_month as (
  select o.party_id as customer_id, date_trunc('month', e.entry_date)::date as mth, sum(al.amount_base) as amt
    from allocations al
    join open_items o on o.id = al.open_item_id
    join journal_entries e on e.id = al.settle_entry_id
   where o.company_id = p_company
     and o.doc_type in ('car_sale', 'car_installment', 'car_scharge_month')
   group by 1, 2
),
custs as (
  select distinct customer_id from car_contracts where company_id = p_company and customer_id is not null
)
select coalesce(jsonb_agg(jsonb_build_object(
    'customer_id', p.id, 'name', p.name, 'phone', p.phone,
    'due_cur',   coalesce((select amt from due_by_month d where d.customer_id = p.id and d.mth = (select m0 from bounds)), 0),
    'due_last',  coalesce((select amt from due_by_month d where d.customer_id = p.id and d.mth = (select m1 from bounds)), 0),
    'due_l2',    coalesce((select amt from due_by_month d where d.customer_id = p.id and d.mth = (select m2 from bounds)), 0),
    'due_l3',    coalesce((select amt from due_by_month d where d.customer_id = p.id and d.mth = (select m3 from bounds)), 0),
    'due_prev',  coalesce((select sum(amt) from due_by_month d where d.customer_id = p.id and d.mth < (select m3 from bounds)), 0),
    'rcpt_cur',  coalesce((select amt from receipts_by_month r where r.customer_id = p.id and r.mth = (select m0 from bounds)), 0),
    'rcpt_last', coalesce((select amt from receipts_by_month r where r.customer_id = p.id and r.mth = (select m1 from bounds)), 0),
    'rcpt_l2',   coalesce((select amt from receipts_by_month r where r.customer_id = p.id and r.mth = (select m2 from bounds)), 0),
    'rcpt_l3',   coalesce((select amt from receipts_by_month r where r.customer_id = p.id and r.mth = (select m3 from bounds)), 0)
  ) order by p.name), '[]'::jsonb)
from parties p
where p.id in (select customer_id from custs);
$function$;

create or replace function public.car_customer_report(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with co as (select auth_company_id() as id),
  cust as (
    select p.id, p.name, p.phone, p.email, p.address, p.iqama_no,
           p.credit_limit, p.credit_days, p.tax_number
    from parties p
    where p.id = p_customer_id and p.company_id = (select id from co)
  ),
  acct as (
    select a.id as account_id
    from accounts a
    where a.party_id = p_customer_id and a.company_id = (select id from co)
    limit 1
  ),
  ledger_bal as (
    select coalesce(sum(l.debit - l.credit), 0) as balance
    from journal_lines l
    join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    where l.account_id = (select account_id from acct)
  ),
  cars_agg as (
    select jsonb_agg(jsonb_build_object(
        'id', c.id, 'contract_no', c.contract_no, 'contract_date', c.contract_date,
        'vehicle', trim(both ' ' from coalesce(v.model_year::text, '') || ' ' || coalesce(v.make, '') || ' ' || coalesce(v.model, '')),
        'plate_no', v.plate_no, 'status', c.status,
        'net_payable', c.net_payable, 'advance', c.advance
      ) order by c.contract_date desc) as cars
    from car_contracts c
    left join car_vehicles v on v.id = c.vehicle_id
    where c.customer_id = p_customer_id and c.company_id = (select id from co)
  ),
  bounds as (select current_date as today),
  item_base as (
    select o.*, coalesce(o.due_date, o.doc_date) as eff_date,
      case
        when o.doc_type in ('car_sale', 'car_installment') then 'car_invoice'
        when o.doc_type = 'car_scharge_month' then 'service_charge'
        else 'other'
      end as type_group,
      coalesce((select sum(al.amount_base) from allocations al where al.open_item_id = o.id), 0) as adjusted
    from open_items o
    where o.account_id = (select account_id from acct)
  ),
  ageing_all as (
    select
      coalesce(sum(outstanding_base) filter (where status = 'open' and eff_date <= (select today from bounds)
        and date_trunc('month', eff_date) = date_trunc('month', (select today from bounds))), 0) as due,
      coalesce(sum(outstanding_base) filter (where status = 'open' and eff_date <= (select today from bounds)
        and date_trunc('month', eff_date) < date_trunc('month', (select today from bounds))), 0) as overdue,
      coalesce(sum(outstanding_base) filter (where status = 'open' and eff_date > (select today from bounds)
        and (eff_date - (select today from bounds)) between 1 and 30), 0) as d30,
      coalesce(sum(outstanding_base) filter (where status = 'open' and eff_date > (select today from bounds)
        and (eff_date - (select today from bounds)) > 30), 0) as d30plus
    from item_base
  ),
  by_type_agg as (
    select jsonb_agg(jsonb_build_object(
        'type_group', type_group,
        'billed', billed, 'receipts', receipts, 'bill_balance', bill_balance,
        'due', due, 'overdue', overdue, 'total_dues', due + overdue
      ) order by type_group) as by_type
    from (
      select type_group,
        coalesce(sum(amount_base), 0) as billed,
        coalesce(sum(adjusted), 0) as receipts,
        coalesce(sum(outstanding_base) filter (where status = 'open'), 0) as bill_balance,
        coalesce(sum(outstanding_base) filter (where status = 'open' and eff_date <= (select today from bounds)
          and date_trunc('month', eff_date) = date_trunc('month', (select today from bounds))), 0) as due,
        coalesce(sum(outstanding_base) filter (where status = 'open' and eff_date <= (select today from bounds)
          and date_trunc('month', eff_date) < date_trunc('month', (select today from bounds))), 0) as overdue
      from item_base
      group by type_group
    ) t
  ),
  bills_agg as (
    select jsonb_agg(jsonb_build_object(
        'doc_no', doc_no, 'doc_date', doc_date, 'due_date', due_date, 'type_group', type_group,
        'amount', amount_base, 'adjusted', adjusted, 'balance', outstanding_base,
        'status', status, 'entry_id', entry_id
      ) order by doc_date, doc_no) as bills
    from item_base
  ),
  month_pts as (
    select (case when o.doc_type in ('car_installment', 'car_scharge_month') and extract(day from o.due_date) = 1
                 then (date_trunc('month', o.due_date) - interval '1 month')::date
                 else date_trunc('month', o.due_date)::date end) as mth,
           o.outstanding_base as due_amt, 0::numeric as rcpt_amt
      from item_base o
     where o.status = 'open'
    union all
    select date_trunc('month', e.entry_date)::date, 0, al.amount_base
      from allocations al
      join item_base o on o.id = al.open_item_id
      join journal_entries e on e.id = al.settle_entry_id
  ),
  month_range as (
    select coalesce(min(mth), date_trunc('month', current_date)::date) as lo,
           coalesce(max(mth), date_trunc('month', current_date)::date) as hi
    from month_pts
  ),
  months as (
    select generate_series((select lo from month_range), (select hi from month_range), interval '1 month')::date as mth
  ),
  monthwise_agg as (
    select jsonb_agg(jsonb_build_object(
        'month', to_char(m.mth, 'YYYY-MM'),
        'due', coalesce((select sum(due_amt) from month_pts d where d.mth = m.mth), 0),
        'receipt', coalesce((select sum(rcpt_amt) from month_pts d where d.mth = m.mth), 0)
      ) order by m.mth) as monthwise
    from months m
  )
  select jsonb_build_object(
    'profile', (select to_jsonb(cust) from cust),
    'account_id', (select account_id from acct),
    'ledger_balance', (select balance from ledger_bal),
    'cars', coalesce((select cars from cars_agg), '[]'::jsonb),
    'ageing', coalesce((select to_jsonb(a) from ageing_all a), '{}'::jsonb),
    'by_type', coalesce((select by_type from by_type_agg), '[]'::jsonb),
    'bills', coalesce((select bills from bills_agg), '[]'::jsonb),
    'monthwise', coalesce((select monthwise from monthwise_agg), '[]'::jsonb)
  );
$function$;
