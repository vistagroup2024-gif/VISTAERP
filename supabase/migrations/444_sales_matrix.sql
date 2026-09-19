-- Sales Report's "View By" (CC Group / Cost Centre / Customer / Product)
-- was four independent, parallel sections — each its own collapsible group
-- inside one table, but never nestable inside each other, because they came
-- from four separate arrays report_sales() already returns (by_cost_centre,
-- by_customer, by_product) with no shared row to nest on. But a sales LINE
-- genuinely carries all three at once: report_sales()'s own by_product_raw
-- already reads item lines off a document whose cost_center and customer
-- are fixed per document — so "this customer's sales broken down by
-- product" or "this cost centre's sales by customer" are real, answerable
-- questions, the same shape Expense Report's cost-centre/account
-- combination turned out to have. report_sales_matrix() is that one flat
-- source: one row per (cost centre, customer, product, month), so the
-- client can nest CC Group / Cost Centre / Customer / Product in whichever
-- combination and CLICK ORDER is asked for, the same system Expense Report
-- (441/442) and P&L (443) already use. report_sales() itself is untouched —
-- the Monthly Trend, By Customer and By Product flat tables, and Sales vs
-- Target (which needs by_cc_month_target, not on this matrix) still read it
-- directly.
create or replace function public.report_sales_matrix(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with sales_docs as (
  select d.doc_date as sdate, d.party_id as customer_id, coalesce(d.cost_center, 'Unassigned') as cost_center, d.id as doc_id, true as is_trade
    from trade_documents d
   where d.company_id = p_company
     and d.doc_type in ('sales_invoice','air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice')
     and d.gl_entry is not null
     and d.doc_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
  union all
  select c.contract_date, c.customer_id, coalesce(c.cost_center, 'Unassigned'), c.id, false
    from car_contracts c
   where c.company_id = p_company and c.status in ('active', 'completed')
     and c.contract_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
),
lines as (
  select sd.doc_id, sd.sdate, sd.customer_id, sd.cost_center,
    coalesce(l.item_name, ap.name, 'Item') as product, coalesce(l.quantity, 0) as qty, coalesce(l.amount, 0) as amount
  from sales_docs sd
  join trade_document_lines l on l.doc_id = sd.doc_id and sd.is_trade
  left join acct_products ap on ap.id = l.product_id
  union all
  select sd.doc_id, sd.sdate, sd.customer_id, sd.cost_center,
    coalesce(ap.name, nullif(trim(concat_ws(' ', v.model_year::text, v.make, v.model, v.variant)), ''), 'Car Sale') as product,
    1 as qty, c.net_payable as amount
  from sales_docs sd
  join car_contracts c on c.id = sd.doc_id and not sd.is_trade
  left join car_vehicles v on v.id = c.vehicle_id
  left join acct_products ap on ap.id = v.product_id
),
cc_lookup as (
  select cc.id, cc.name, coalesce(pg.name, cc.name) as grp
  from acct_cost_centers cc left join acct_cost_centers pg on pg.id = cc.parent_id
  where cc.company_id = p_company and cc.is_group = false
),
agg as (
  select cost_center, customer_id, product, to_char(sdate, 'YYYY-MM') as month,
    sum(amount) as amount, sum(qty) as qty
  from lines group by 1, 2, 3, 4
)
select coalesce(jsonb_agg(jsonb_build_object(
    'cost_center_id', cc.id, 'cost_center', coalesce(cc.name, x.cost_center), 'cost_center_group', coalesce(cc.grp, x.cost_center),
    'customer', coalesce(p.name, 'Unspecified'), 'customer_account_id', acc.id,
    'product', x.product,
    'month', x.month, 'amount', coalesce(x.amount, 0), 'qty', coalesce(x.qty, 0)
  )), '[]'::jsonb)
from agg x
left join cc_lookup cc on cc.name = x.cost_center
left join parties p on p.id = x.customer_id
left join accounts acc on acc.party_id = p.id;
$function$;

revoke all on function public.report_sales_matrix(uuid, date, date) from public, anon;
grant execute on function public.report_sales_matrix(uuid, date, date) to authenticated;

do $chk$
declare
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_year    int  := extract(year from current_date)::int;
  v_result  jsonb;
  v_amount numeric; v_qty numeric;
  d_amount numeric; d_qty numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_sales_matrix(v_company, make_date(v_year,1,1), make_date(v_year,12,31)) into v_result;
  select coalesce(sum((r->>'amount')::numeric),0), coalesce(sum((r->>'qty')::numeric),0) into v_amount, v_qty
  from jsonb_array_elements(v_result) r;

  with sales_docs as (
    select d.doc_date as sdate, d.id as doc_id, true as is_trade
      from trade_documents d
     where d.company_id = v_company
       and d.doc_type in ('sales_invoice','air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice')
       and d.gl_entry is not null
       and d.doc_date between make_date(v_year,1,1) and make_date(v_year,12,31)
    union all
    select c.contract_date, c.id, false
      from car_contracts c
     where c.company_id = v_company and c.status in ('active', 'completed')
       and c.contract_date between make_date(v_year,1,1) and make_date(v_year,12,31)
  )
  select coalesce(sum(amount),0), coalesce(sum(qty),0) into d_amount, d_qty
  from (
    select coalesce(l.amount,0) as amount, coalesce(l.quantity,0) as qty
    from sales_docs sd join trade_document_lines l on l.doc_id = sd.doc_id and sd.is_trade
    union all
    select c.net_payable, 1
    from sales_docs sd join car_contracts c on c.id = sd.doc_id and not sd.is_trade
  ) z;

  if abs(v_amount - d_amount) > 0.01 or abs(v_qty - d_qty) > 0.01 then
    raise exception 'report_sales_matrix self-check mismatch: amount %/%  qty %/%', v_amount, d_amount, v_qty, d_qty;
  end if;

  raise notice 'self-check passed: amount=% qty=% rows=%', v_amount, v_qty, jsonb_array_length(v_result);
end;
$chk$;
