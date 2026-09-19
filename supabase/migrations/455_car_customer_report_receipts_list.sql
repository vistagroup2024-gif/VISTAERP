-- car_customer_report()'s consumer (the customer detail page,
-- /car-sales/customers/[id]) read car_receipts directly for its own
-- "Recent Receipts" list — the same shadow-ledger table 453 already moved
-- the aggregate figures off of. A receipt taken through the ordinary
-- Receipt Voucher (bill-wise adjusted in the popup, not through the car
-- module's own Receipt tab) never writes a car_receipts row, so it never
-- appeared on this list either, even after 453 fixed the KPI totals above
-- it — the exact page a user checking "did my receipt post" would land on
-- next. Adds a 'receipts' array to car_customer_report()'s own output,
-- built the same way month_pts already is: every bill-wise settlement
-- against one of this customer's bills (allocations -> open_items ->
-- the settling journal_entries), whichever voucher screen made it.
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
  receipts_agg as (
    select jsonb_agg(jsonb_build_object(
        'entry_id', e.id, 'entry_no', e.entry_no, 'entry_date', e.entry_date,
        'doc_no', o.doc_no, 'amount', al.amount_base
      ) order by e.entry_date desc, e.entry_no desc) as receipts
    from allocations al
    join item_base o on o.id = al.open_item_id
    join journal_entries e on e.id = al.settle_entry_id
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
    'receipts', coalesce((select receipts from receipts_agg), '[]'::jsonb),
    'monthwise', coalesce((select monthwise from monthwise_agg), '[]'::jsonb)
  );
$function$;
