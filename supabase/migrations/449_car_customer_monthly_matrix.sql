-- Car Customer Balances gets three new/rebuilt month-matrix views, all off
-- this one flat RPC (Billed/Receipts pivoted client-side, the same
-- flat-matrix-then-pivot shape report_expense_matrix()/report_pl_matrix()/
-- report_sales_matrix() already use) so the three tabs can never disagree
-- with each other about what a given customer's given month holds.
--
-- "Billed" is the ORIGINAL scheduled amount (installment/service-charge/
-- advance), not netted against payments — a car customer's monthly
-- schedule, not an outstanding-only ageing view (that's what the existing
-- Customer Due Ageing Summary tab, and car_customer_monthwise(), already
-- do, untouched here).
--
-- An instalment or service charge due on the 1ST of a month is attributed
-- to the PRECEDING month, not the due date's own month: "September's
-- instalment/charge is due 1 October, so it belongs under September" — the
-- same convention Monthly Charges already uses for its own due date
-- (`due_date = next month's 1st`), now applied when READING the schedule
-- back for this report too, not just when raising the bill. The advance is
-- a one-time bill tied to the invoice, not a recurring monthly item, so it
-- keeps its own due/contract date unshifted.
create or replace function public.car_customer_monthly_matrix(p_company uuid)
returns table (
  customer_id uuid,
  name text,
  month date,
  billed numeric,
  receipts numeric
)
language sql stable
set search_path to 'public'
as $$
with billed_items as (
  select c.customer_id,
         (case when extract(day from i.due_date) = 1
               then (date_trunc('month', i.due_date) - interval '1 month')::date
               else date_trunc('month', i.due_date)::date end) as mth,
         i.amount as amt
    from car_installments i join car_contracts c on c.id = i.contract_id
   where c.company_id = p_company
  union all
  select s.customer_id,
         (case when extract(day from s.due_date) = 1
               then (date_trunc('month', s.due_date) - interval '1 month')::date
               else date_trunc('month', s.due_date)::date end) as mth,
         s.amount as amt
    from car_service_charges s where s.company_id = p_company
  union all
  select c.customer_id, date_trunc('month', coalesce(c.advance_due_date, c.contract_date))::date as mth, c.advance as amt
    from car_contracts c where c.company_id = p_company and coalesce(c.advance, 0) > 0
),
billed_by_month as (
  select customer_id, mth, sum(amt) as amt from billed_items group by 1, 2
),
receipts_by_month as (
  select customer_id, date_trunc('month', receipt_date)::date as mth, sum(amount) as amt
    from car_receipts where company_id = p_company group by 1, 2
),
custs as (select distinct customer_id from car_contracts where company_id = p_company and customer_id is not null),
months as (
  select customer_id, mth from billed_by_month
  union
  select customer_id, mth from receipts_by_month
)
select p.id, p.name, m.mth,
       coalesce(b.amt, 0), coalesce(r.amt, 0)
  from custs c
  join parties p on p.id = c.customer_id
  join months m on m.customer_id = c.customer_id
  left join billed_by_month b on b.customer_id = m.customer_id and b.mth = m.mth
  left join receipts_by_month r on r.customer_id = m.customer_id and r.mth = m.mth
 order by p.name, m.mth;
$$;

revoke all on function public.car_customer_monthly_matrix(uuid) from public, anon;
grant execute on function public.car_customer_monthly_matrix(uuid) to authenticated;
