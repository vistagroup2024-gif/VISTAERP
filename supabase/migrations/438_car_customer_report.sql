-- The Customer Report screen (/car-sales/customers/[id]) reads this one call
-- for everything it needs: profile, cars, ledger-true balance, an ageing
-- breakdown shaped exactly like ar_ap_aging's (due/overdue/1-30/30+, so the
-- two never disagree on what "due" means), a billed/receipts/balance KPI row
-- per invoice type (Car Invoice vs Monthly Charges vs anything else billed
-- to this account), every bill this account has ever carried with what has
-- been adjusted against it (the `allocations` table, driven by
-- apply_billwise_allocations), and a monthwise due/receipt schedule that -
-- because this is one customer, not the whole book - is not capped to
-- +/-3 months the way car_customer_monthwise() has to be for performance
-- across every customer at once. It runs the true schedule from whatever a
-- car_installments/car_service_charges/car_receipts row actually holds.
create or replace function public.car_customer_report(p_customer_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
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
    select date_trunc('month', i.due_date)::date as mth, greatest(i.amount - i.paid_amount, 0) as due_amt, 0::numeric as rcpt_amt
      from car_installments i join car_contracts c on c.id = i.contract_id
     where c.customer_id = p_customer_id and c.company_id = (select id from co)
    union all
    select date_trunc('month', coalesce(c.advance_due_date, c.contract_date))::date,
      greatest(coalesce(c.advance, 0) - coalesce(adv.paid, 0), 0), 0
      from car_contracts c
      left join lateral (
        select coalesce(sum(al.amount), 0) as paid from car_receipt_allocations al
        join car_receipts r on r.id = al.receipt_id
        where r.contract_id = c.id and al.target_type = 'advance') adv on true
     where c.customer_id = p_customer_id and c.company_id = (select id from co) and coalesce(c.advance, 0) > 0
    union all
    select date_trunc('month', s.due_date)::date, greatest(s.amount - s.paid_amount, 0), 0
      from car_service_charges s
     where s.customer_id = p_customer_id and s.company_id = (select id from co)
    union all
    select date_trunc('month', r.receipt_date)::date, 0, r.amount
      from car_receipts r
     where r.customer_id = p_customer_id and r.company_id = (select id from co)
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

revoke all on function public.car_customer_report(uuid) from public, anon;
grant execute on function public.car_customer_report(uuid) to authenticated;
