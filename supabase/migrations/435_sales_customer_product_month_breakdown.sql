-- The old software's Sales Report has a Monthwise pivot that switches its
-- dimension between CC Group / Cost Centre / Customer / Product, with a
-- Qty-vs-Value toggle. 431 already added by_cc_month (Cost Centre x Month)
-- for the Cost Centre dimension; this migration is the same pattern applied
-- to Customer and Product -- by_customer_month and by_product_month, exact
-- finer groupings of the same sales_docs / by_product_raw rows the existing
-- by_customer / by_product totals already come from, not a second,
-- independently-derived calculation. by_cc_month also gains `txns` (it only
-- had `amount`), matching by_cc's own shape, so the Qty toggle on the Cost
-- Centre dimension has a real transaction count to show, not just Product's
-- item quantity.
--
-- Self-checked before applying (rolled back, not committed): by_customer_month's
-- amounts sum back to the exact same 'total' report_sales already returns;
-- by_cc_month's txns sum back to the same top-level 'txns'.
create or replace function public.report_sales(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with sales_docs as (
  select d.doc_date as sdate, d.total, d.party_id as customer_id, d.cost_center, d.id as doc_id, true as is_trade
    from trade_documents d
   where d.company_id = p_company
     and d.doc_type in ('sales_invoice','air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice')
     and d.gl_entry is not null
     and d.doc_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
  union all
  select c.contract_date, c.net_payable, c.customer_id, c.cost_center, c.id, false
    from car_contracts c
   where c.company_id = p_company and c.status in ('active', 'completed')
     and c.contract_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
),
cc_groups as (
  select cc.name, coalesce(pg.name, cc.name) as group_name
  from acct_cost_centers cc
  left join acct_cost_centers pg on pg.id = cc.parent_id
  where cc.company_id = p_company
),
by_month as (
  select to_char(sdate, 'YYYY-MM') as month, sum(total) as amount, count(*) as txns
  from sales_docs group by 1
),
by_cc as (
  select coalesce(cost_center, 'Unassigned') as name, sum(total) as amount, count(*) as txns
  from sales_docs group by 1
),
by_cc_month as (
  select coalesce(cost_center, 'Unassigned') as name, to_char(sdate, 'YYYY-MM') as month, sum(total) as amount, count(*) as txns
  from sales_docs group by 1, 2
),
by_customer as (
  select coalesce(p.name, 'Unspecified') as name, acc.id as account_id, sum(sd.total) as amount, count(*) as txns
  from sales_docs sd left join parties p on p.id = sd.customer_id
  left join accounts acc on acc.party_id = p.id
  group by 1, 2
),
by_customer_month as (
  select coalesce(p.name, 'Unspecified') as name, acc.id as account_id, to_char(sd.sdate, 'YYYY-MM') as month,
    sum(sd.total) as amount, count(*) as txns
  from sales_docs sd left join parties p on p.id = sd.customer_id
  left join accounts acc on acc.party_id = p.id
  group by 1, 2, 3
),
by_product_raw as (
  select coalesce(l.item_name, ap.name, 'Item') as name, sum(l.quantity) as qty, sum(l.amount) as amount
  from sales_docs sd
  join trade_document_lines l on l.doc_id = sd.doc_id and sd.is_trade
  left join acct_products ap on ap.id = l.product_id
  group by 1
  union all
  select coalesce(ap.name, nullif(trim(concat_ws(' ', v.model_year::text, v.make, v.model, v.variant)), ''), 'Car Sale') as name,
    1 as qty, sd.total as amount
  from sales_docs sd
  join car_contracts c on c.id = sd.doc_id and not sd.is_trade
  left join car_vehicles v on v.id = c.vehicle_id
  left join acct_products ap on ap.id = v.product_id
),
by_product as (
  select name, sum(qty) as qty, sum(amount) as amount from by_product_raw group by 1
),
by_product_month_raw as (
  select coalesce(l.item_name, ap.name, 'Item') as name, to_char(sd.sdate, 'YYYY-MM') as month,
    sum(l.quantity) as qty, sum(l.amount) as amount
  from sales_docs sd
  join trade_document_lines l on l.doc_id = sd.doc_id and sd.is_trade
  left join acct_products ap on ap.id = l.product_id
  group by 1, 2
  union all
  select coalesce(ap.name, nullif(trim(concat_ws(' ', v.model_year::text, v.make, v.model, v.variant)), ''), 'Car Sale') as name,
    to_char(sd.sdate, 'YYYY-MM') as month, 1 as qty, sd.total as amount
  from sales_docs sd
  join car_contracts c on c.id = sd.doc_id and not sd.is_trade
  left join car_vehicles v on v.id = c.vehicle_id
  left join acct_products ap on ap.id = v.product_id
),
by_product_month as (
  select name, month, sum(qty) as qty, sum(amount) as amount from by_product_month_raw group by 1, 2
)
select jsonb_build_object(
  'total', (select coalesce(sum(total), 0) from sales_docs),
  'txns', (select count(*) from sales_docs),
  'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount, 'txns', txns) order by month), '[]'::jsonb) from by_month),
  'by_cost_centre', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', by_cc.name, 'cost_center_group', coalesce(cg.group_name, 'Unassigned'),
      'amount', by_cc.amount, 'txns', by_cc.txns) order by by_cc.amount desc), '[]'::jsonb)
    from by_cc left join cc_groups cg on cg.name = by_cc.name),
  'by_cc_month', (select coalesce(jsonb_agg(jsonb_build_object(
      'cost_center', by_cc_month.name, 'cost_center_group', coalesce(cg.group_name, 'Unassigned'),
      'month', by_cc_month.month, 'amount', by_cc_month.amount, 'txns', by_cc_month.txns) order by by_cc_month.name, by_cc_month.month), '[]'::jsonb)
    from by_cc_month left join cc_groups cg on cg.name = by_cc_month.name),
  'by_customer', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'account_id', account_id, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_customer),
  'by_customer_month', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'account_id', account_id, 'month', month, 'amount', amount, 'txns', txns) order by name, month), '[]'::jsonb) from by_customer_month),
  'by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'amount', amount) order by amount desc), '[]'::jsonb) from by_product),
  'by_product_month', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'month', month, 'qty', qty, 'amount', amount) order by name, month), '[]'::jsonb) from by_product_month)
);
$function$;

revoke all on function public.report_sales(uuid, date, date) from public, anon;
grant execute on function public.report_sales(uuid, date, date) to authenticated;
