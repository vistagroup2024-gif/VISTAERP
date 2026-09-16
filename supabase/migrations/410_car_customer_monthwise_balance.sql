-- Car Customer Balances' "Monthly Balance" tab: what each customer was due
-- and what they paid, current month back through 3 months ago plus
-- everything older, per the requested field list (Current/Last/2nd Last/3rd
-- Last Month Due, Previous Due, and the matching Receipts columns). Same
-- three due-date sources car_customer_balances()/dashboard_metrics()'s
-- car_money already use — instalments, the advance leg, the monthly service
-- charge — just bucketed by the MONTH the amount falls due in rather than
-- collapsed into a single due/overdue split, because a month-by-month
-- collections view is a different question than "what is owed right now."
create or replace function public.car_customer_monthwise(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with bounds as (
  select date_trunc('month', current_date)::date as m0,
         (date_trunc('month', current_date) - interval '1 month')::date as m1,
         (date_trunc('month', current_date) - interval '2 month')::date as m2,
         (date_trunc('month', current_date) - interval '3 month')::date as m3
),
due_items as (
  select c.customer_id, date_trunc('month', i.due_date)::date as mth,
    greatest(i.amount - i.paid_amount, 0) as amt
  from car_installments i join car_contracts c on c.id = i.contract_id
  where c.company_id = p_company
  union all
  select c.customer_id, date_trunc('month', coalesce(c.advance_due_date, c.contract_date))::date,
    greatest(coalesce(c.advance, 0) - coalesce(adv.paid, 0), 0)
  from car_contracts c
  left join lateral (
    select coalesce(sum(al.amount), 0) as paid from car_receipt_allocations al
     join car_receipts r on r.id = al.receipt_id
    where r.contract_id = c.id and al.target_type = 'advance') adv on true
  where c.company_id = p_company and coalesce(c.advance, 0) > 0
  union all
  select s.customer_id, date_trunc('month', s.due_date)::date, greatest(s.amount - s.paid_amount, 0)
  from car_service_charges s where s.company_id = p_company
),
due_by_month as (
  select customer_id, mth, sum(amt) as amt from due_items where amt > 0 group by 1, 2
),
receipts_by_month as (
  select customer_id, date_trunc('month', receipt_date)::date as mth, sum(amount) as amt
  from car_receipts where company_id = p_company group by 1, 2
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

revoke all on function public.car_customer_monthwise(uuid) from public, anon;
grant execute on function public.car_customer_monthwise(uuid) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_result jsonb;
  v_bucketed_total numeric;
  v_raw_total numeric;
  v_m0 date := date_trunc('month', current_date)::date;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.car_customer_monthwise(v_company) into v_result;
  select coalesce(sum(
    (r->>'due_cur')::numeric + (r->>'due_last')::numeric + (r->>'due_l2')::numeric +
    (r->>'due_l3')::numeric + (r->>'due_prev')::numeric), 0) into v_bucketed_total
  from jsonb_array_elements(v_result) r;

  -- No due amount lost or duplicated between the union and the per-customer
  -- month buckets: the five buckets together cover everything due in the
  -- current month or earlier (nothing due in a FUTURE month belongs on a
  -- collections-history view), so the raw check is scoped the same way.
  select coalesce(sum(greatest(i.amount - i.paid_amount, 0))
    filter (where date_trunc('month', i.due_date) <= v_m0), 0)
       + coalesce((select sum(greatest(coalesce(c.advance, 0) - coalesce(adv.paid, 0), 0))
                     from car_contracts c
                     left join lateral (
                       select coalesce(sum(al.amount), 0) as paid from car_receipt_allocations al
                        join car_receipts r on r.id = al.receipt_id
                       where r.contract_id = c.id and al.target_type = 'advance') adv on true
                    where c.company_id = v_company and coalesce(c.advance, 0) > 0
                      and date_trunc('month', coalesce(c.advance_due_date, c.contract_date)) <= v_m0), 0)
       + coalesce((select sum(greatest(s.amount - s.paid_amount, 0)) from car_service_charges s
                    where s.company_id = v_company and date_trunc('month', s.due_date) <= v_m0), 0)
    into v_raw_total
  from car_installments i join car_contracts c on c.id = i.contract_id where c.company_id = v_company;

  if abs(v_bucketed_total - v_raw_total) > 0.01 then
    raise exception 'car_customer_monthwise self-check: bucketed total % does not match raw due total (current month or earlier) %', v_bucketed_total, v_raw_total;
  end if;

  raise notice 'car_customer_monthwise self-check passed: customers=%, bucketed_total=%', jsonb_array_length(v_result), v_bucketed_total;
end;
$chk$;
