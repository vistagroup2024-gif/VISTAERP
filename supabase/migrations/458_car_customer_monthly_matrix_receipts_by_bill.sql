-- Billed vs Receipts Monthwise (tab 4) is a collection-performance view —
-- "how much did we bill for August, and how much of THAT has been
-- collected" — so its own Receipts column needs to attribute a settlement
-- to the BILL'S own (period-shifted) month, not the calendar month the
-- cash happened to post in. car_customer_monthly_matrix()'s existing
-- 'receipts' column (456) is right for Receipts Monthwise (tab 3, a pure
-- cash-flow-by-month view — "received in September" is correct there,
-- confirmed) but wrong for tab 4: ABDUL JALAL's 15,000, settled in
-- September against the August advance bill (CI-000005 advance, due
-- 2026-08-26), read as a September receipt on Billed vs Receipts too,
-- when the bill it paid down was August's.
--
-- Adds 'receipts_by_bill' — same allocations/open_items join as
-- 'receipts', but keyed on the settled bill's own due_date (the same
-- period-shift rule 'billed'/'outstanding' already apply), not the
-- settling entry's entry_date. Tab 4 switches to this column; tab 3 keeps
-- reading 'receipts' unchanged.
drop function if exists public.car_customer_monthly_matrix(uuid);

create or replace function public.car_customer_monthly_matrix(p_company uuid)
 RETURNS TABLE(customer_id uuid, name text, month date, billed numeric, outstanding numeric, receipts numeric, receipts_by_bill numeric)
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
receipts_by_bill_month as (
  select o.party_id as customer_id,
         (case when o.doc_type in ('car_installment', 'car_scharge_month') and extract(day from o.due_date) = 1
               then (date_trunc('month', o.due_date) - interval '1 month')::date
               else date_trunc('month', o.due_date)::date end) as mth,
         sum(al.amount_base) as amt
    from allocations al
    join open_items o on o.id = al.open_item_id
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
  union
  select customer_id, mth from receipts_by_bill_month
)
select p.id, p.name, m.mth,
       coalesce(b.amt, 0), coalesce(o.amt, 0), coalesce(r.amt, 0), coalesce(rb.amt, 0)
  from custs c
  join parties p on p.id = c.customer_id
  join months m on m.customer_id = c.customer_id
  left join billed_by_month b on b.customer_id = m.customer_id and b.mth = m.mth
  left join outstanding_by_month o on o.customer_id = m.customer_id and o.mth = m.mth
  left join receipts_by_month r on r.customer_id = m.customer_id and r.mth = m.mth
  left join receipts_by_bill_month rb on rb.customer_id = m.customer_id and rb.mth = m.mth
 order by p.name, m.mth;
$function$;

revoke all on function public.car_customer_monthly_matrix(uuid) from public, anon;
grant execute on function public.car_customer_monthly_matrix(uuid) to authenticated;
