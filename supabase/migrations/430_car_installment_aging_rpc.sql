-- Bug fix: the Installment Aging report (app/(erp)/car-sales/reports/aging)
-- summed only car_installments, ignoring the advance-due leg and monthly
-- service charges — exactly the trap migration 401's car_customer_balances()
-- was written to close for the Outstanding/Customer Summary reports, never
-- applied here. Also fixes the day-bucket math, which subtracted a
-- UTC-midnight-anchored due date from Date.now() (an absolute instant)
-- client-side instead of from Saudi "today" — wrong for the first ~3 hours
-- of the Saudi day, the exact bug class CLAUDE.md's "clock is Saudi"
-- section warns about.
--
-- car_installment_aging() reuses the identical three-source due list
-- dashboard_metrics()'s car_due_items CTE already established (installments,
-- advance, service charges) — grouped per CONTRACT instead of per customer,
-- since this report (unlike car_customer_balances()) is contract-level and
-- keeps its five ageing buckets. current_date is bucketed against directly:
-- it is Saudi on this role already (migration 311), so there is no
-- client-side date-arithmetic bug left to have.
create or replace function public.car_installment_aging()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with co as (select auth_company_id() as id),
due_items as (
  select c.id as contract_id, i.due_date as due,
         greatest(i.amount - i.paid_amount, 0) as amt
    from car_installments i
    join car_contracts c on c.id = i.contract_id
   where c.company_id = (select id from co) and c.status <> 'cancelled'
  union all
  select c.id, coalesce(c.advance_due_date, c.contract_date),
         greatest(coalesce(c.advance, 0) - coalesce(adv.paid, 0), 0)
    from car_contracts c
    left join lateral (
      select coalesce(sum(al.amount), 0) as paid
        from car_receipt_allocations al
        join car_receipts r on r.id = al.receipt_id
       where r.contract_id = c.id and al.target_type = 'advance') adv on true
   where c.company_id = (select id from co) and c.status <> 'cancelled' and coalesce(c.advance, 0) > 0
  union all
  select s.contract_id, s.due_date, greatest(s.amount - s.paid_amount, 0)
    from car_service_charges s
    join car_contracts c on c.id = s.contract_id
   where c.company_id = (select id from co) and c.status <> 'cancelled'
),
per_contract as (
  select d.contract_id,
    sum(case when d.due >= current_date then d.amt else 0 end) as current,
    sum(case when d.due < current_date and (current_date - d.due) <= 30 then d.amt else 0 end) as d30,
    sum(case when d.due < current_date and (current_date - d.due) > 30 and (current_date - d.due) <= 60 then d.amt else 0 end) as d60,
    sum(case when d.due < current_date and (current_date - d.due) > 60 and (current_date - d.due) <= 90 then d.amt else 0 end) as d90,
    sum(case when d.due < current_date and (current_date - d.due) > 90 then d.amt else 0 end) as d90p,
    sum(d.amt) as total
  from due_items d
  where d.amt > 0.005
  group by d.contract_id
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id', c.id, 'contract_no', c.contract_no, 'customer', p.name,
  'current', pc.current, 'd30', pc.d30, 'd60', pc.d60, 'd90', pc.d90, 'd90p', pc.d90p, 'total', pc.total
) order by pc.total desc), '[]'::jsonb)
from per_contract pc
join car_contracts c on c.id = pc.contract_id
left join parties p on p.id = c.customer_id
where pc.total > 0.005;
$function$;

revoke all on function public.car_installment_aging() from public, anon;
grant execute on function public.car_installment_aging() to authenticated;
