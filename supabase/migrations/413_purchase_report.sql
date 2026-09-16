-- Purchase side of Purchase vs Sale, and the Purchase Report on its own.
-- Reuses the exact "posted Purchase Voucher" definition dashboard_metrics()'s
-- purchase_vs_sale block already established (doc_type = 'purchase_voucher'
-- and gl_entry is not null), broken down by month, cost centre, supplier and
-- product — report_sales() (migration 409) is the sale-side twin this pairs
-- with on the Purchase vs Sale screen.
create or replace function public.report_purchases(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with purch_docs as (
  select d.doc_date as pdate, d.total, d.party_id as supplier_id, d.cost_center, d.id as doc_id
    from trade_documents d
   where d.company_id = p_company and d.doc_type = 'purchase_voucher' and d.gl_entry is not null
     and d.doc_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
),
by_month as (
  select to_char(pdate, 'YYYY-MM') as month, sum(total) as amount, count(*) as txns
  from purch_docs group by 1
),
by_cc as (
  select coalesce(cost_center, 'Unassigned') as name, sum(total) as amount, count(*) as txns
  from purch_docs group by 1
),
by_supplier as (
  select coalesce(p.name, 'Unspecified') as name, sum(pd.total) as amount, count(*) as txns
  from purch_docs pd left join parties p on p.id = pd.supplier_id
  group by 1
),
by_product as (
  select coalesce(l.item_name, ap.name, 'Item') as name, sum(l.quantity) as qty, sum(l.amount) as amount
  from purch_docs pd join trade_document_lines l on l.doc_id = pd.doc_id
  left join acct_products ap on ap.id = l.product_id
  group by 1
)
select jsonb_build_object(
  'total', (select coalesce(sum(total), 0) from purch_docs),
  'txns', (select count(*) from purch_docs),
  'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount, 'txns', txns) order by month), '[]'::jsonb) from by_month),
  'by_cost_centre', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_cc),
  'by_supplier', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_supplier),
  'by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'amount', amount) order by amount desc), '[]'::jsonb) from by_product)
);
$function$;

revoke all on function public.report_purchases(uuid, date, date) from public, anon;
grant execute on function public.report_purchases(uuid, date, date) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_month_start date := date_trunc('month', current_date)::date;
  v_result numeric;
  v_card numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select (public.report_purchases(v_company, v_month_start, current_date) ->> 'total')::numeric into v_result;
  select (public.dashboard_metrics() -> 'purchase_vs_sale' ->> 'purchase_month')::numeric into v_card;

  if abs(v_result - v_card) > 0.01 then
    raise exception 'report_purchases self-check: this-month total % does not match dashboard purchase_vs_sale.purchase_month %', v_result, v_card;
  end if;

  raise notice 'report_purchases self-check passed: this_month_total=%', v_result;
end;
$chk$;
