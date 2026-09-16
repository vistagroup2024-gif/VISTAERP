-- Sales Report — the dashboard's Sales card detail screen. Customer- and
-- product-level breakdown needs document data, so this reads the same
-- "every sale the business made" definition dashboard_metrics()'s own
-- purchase_vs_sale block already established (Sales Invoice, the four
-- service invoices, and the Car Invoice, which is not a trade document) —
-- not the GL income-account total the Sales *card* shows, which is a wider
-- lens (any income posting, with no document behind it necessarily) that
-- cannot be broken down by customer or product at all. Both are correct,
-- intentionally different questions; this report reuses the one that already
-- has a customer and a product on it, rather than inventing a third.
create or replace function public.report_sales(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql STABLE
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
by_month as (
  select to_char(sdate, 'YYYY-MM') as month, sum(total) as amount, count(*) as txns
  from sales_docs group by 1
),
by_cc as (
  select coalesce(cost_center, 'Unassigned') as name, sum(total) as amount, count(*) as txns
  from sales_docs group by 1
),
by_customer as (
  select coalesce(p.name, 'Unspecified') as name, sum(sd.total) as amount, count(*) as txns
  from sales_docs sd left join parties p on p.id = sd.customer_id
  group by 1
),
by_product as (
  select coalesce(l.item_name, ap.name, 'Car Sale') as name, sum(l.amount) as amount
  from sales_docs sd
  left join trade_document_lines l on l.doc_id = sd.doc_id and sd.is_trade
  left join acct_products ap on ap.id = l.product_id
  where l.id is not null
  group by 1
)
select jsonb_build_object(
  'total', (select coalesce(sum(total), 0) from sales_docs),
  'txns', (select count(*) from sales_docs),
  'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount, 'txns', txns) order by month), '[]'::jsonb) from by_month),
  'by_cost_centre', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_cc),
  'by_customer', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_customer),
  'by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount) order by amount desc), '[]'::jsonb) from by_product)
);
$function$;

revoke all on function public.report_sales(uuid, date, date) from public, anon;
grant execute on function public.report_sales(uuid, date, date) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_month_start date := date_trunc('month', current_date)::date;
  v_result numeric;
  v_card numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select (public.report_sales(v_company, v_month_start, current_date) ->> 'total')::numeric into v_result;
  select (public.dashboard_metrics() -> 'purchase_vs_sale' ->> 'sale_month')::numeric into v_card;

  if abs(v_result - v_card) > 0.01 then
    raise exception 'report_sales self-check: this-month total % does not match dashboard purchase_vs_sale.sale_month %', v_result, v_card;
  end if;

  raise notice 'report_sales self-check passed: this_month_total=%', v_result;
end;
$chk$;
