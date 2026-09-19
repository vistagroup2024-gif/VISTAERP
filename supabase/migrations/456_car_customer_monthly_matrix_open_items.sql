-- car_customer_monthly_matrix() (449) is the flat RPC behind THREE of Car
-- Customer Balances' tabs (Monthly Balances, Receipts Monthwise, Billed vs
-- Receipts Monthwise) and had the exact same shadow-ledger bug 453 already
-- fixed in the other three car customer RPCs — missed in that pass because
-- it's a fourth, separate sibling calculation over the same underlying
-- tables, not read from the same call site.
--
-- 'receipts' read car_receipts directly, so a receipt taken through the
-- ordinary Receipt Voucher (bill-wise adjusted, not through the car
-- module's own Receipt tab — the exact ABDUL JALAL case 453 fixed
-- elsewhere) never appeared in Receipts Monthwise or in Billed vs
-- Receipts' own Receipts column, for the identical reason.
--
-- 'billed' was always the gross ORIGINAL schedule, deliberately never
-- netted against payment (car_customer_monthly_matrix's own long-standing
-- design, documented above as "what was this customer's schedule" versus
-- Ageing Summary's netted "what's still owed" — a real, useful distinction
-- for tab 4's Billed-vs-Receipts comparison). But once that same field was
-- relabelled "Due" on the Monthly Balances tab, "Due" not moving after a
-- real receipt read as broken, correctly — "Due" has to mean what's
-- actually still owed, not the original amount regardless of payment.
-- Adds 'outstanding' as a genuinely separate, net figure (from open_items,
-- the same source 453 already reads) rather than repurposing 'billed' —
-- tab 4's own comparison still needs the gross figure to mean anything.
create or replace function public.car_customer_monthly_matrix(p_company uuid)
 RETURNS TABLE(customer_id uuid, name text, month date, billed numeric, outstanding numeric, receipts numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
outstanding_items as (
  select o.party_id as customer_id,
         (case when o.doc_type in ('car_installment', 'car_scharge_month') and extract(day from o.due_date) = 1
               then (date_trunc('month', o.due_date) - interval '1 month')::date
               else date_trunc('month', o.due_date)::date end) as mth,
         o.outstanding_base as amt
    from open_items o
   where o.company_id = p_company and o.status = 'open'
     and o.doc_type in ('car_sale', 'car_installment', 'car_scharge_month')
),
outstanding_by_month as (
  select customer_id, mth, sum(amt) as amt from outstanding_items group by 1, 2
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
custs as (select distinct customer_id from car_contracts where company_id = p_company and customer_id is not null),
months as (
  select customer_id, mth from billed_by_month
  union
  select customer_id, mth from outstanding_by_month
  union
  select customer_id, mth from receipts_by_month
)
select p.id, p.name, m.mth,
       coalesce(b.amt, 0), coalesce(o.amt, 0), coalesce(r.amt, 0)
  from custs c
  join parties p on p.id = c.customer_id
  join months m on m.customer_id = c.customer_id
  left join billed_by_month b on b.customer_id = m.customer_id and b.mth = m.mth
  left join outstanding_by_month o on o.customer_id = m.customer_id and o.mth = m.mth
  left join receipts_by_month r on r.customer_id = m.customer_id and r.mth = m.mth
 order by p.name, m.mth;
$function$;
