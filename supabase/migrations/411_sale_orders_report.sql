-- Sale Orders had no list/grid anywhere — the dashboard's Pending Sales
-- Orders and Sale Order · Advance vs Receipt cards both linked straight to
-- the blank voucher editor (find-by-number only). One RPC serves both: the
-- Sales Orders report (pending vs history) and the Advance vs Receipt report
-- (same rows, grouped by whether the advance is fully in). Advance/received
-- read exactly the logic dashboard_metrics()'s own so_pending CTE already
-- uses, so all three screens agree.
create or replace function public.report_sale_orders(p_company uuid, p_status text default 'pending')
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with td as (
  select d.*,
    (exists (select 1 from trade_documents x where x.source_doc_id = d.id)
     or exists (select 1 from car_contracts cc where cc.source_doc_id = d.id)) as consumed
  from trade_documents d
  where d.company_id = p_company and d.doc_type = 'sale_order'
),
visible as (
  select d.id as doc_id from td d
  where case p_status when 'pending' then not d.consumed when 'history' then d.consumed else true end
),
rows as (
  select d.id as doc_id, d.doc_no, d.doc_date, d.delivery_date, d.cost_center, d.status, d.consumed,
    coalesce(p.name, 'Unspecified') as customer, d.total,
    case when d.meta->>'advance' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then (d.meta->>'advance')::numeric else 0 end as advance,
    coalesce((select sum(r.amount) from car_receipts r where r.source_doc_id = d.id), 0) as advance_received
  from td d
  join visible v on v.doc_id = d.id
  left join parties p on p.id = d.party_id
),
lines as (
  select l.doc_id, coalesce(l.item_name, ap.name, 'Item') as product, sum(l.quantity) as qty, sum(l.amount) as amount
  from trade_document_lines l
  join visible v on v.doc_id = l.doc_id
  left join acct_products ap on ap.id = l.product_id
  group by l.doc_id, coalesce(l.item_name, ap.name, 'Item')
)
select jsonb_build_object(
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'doc_id', r.doc_id, 'doc_no', r.doc_no, 'doc_date', r.doc_date, 'delivery_date', r.delivery_date,
      'cost_centre', coalesce(r.cost_center, 'Unassigned'), 'status', r.status, 'consumed', r.consumed,
      'customer', r.customer, 'total', r.total,
      'advance', r.advance, 'advance_received', r.advance_received, 'advance_balance', r.advance - r.advance_received
    ) order by r.doc_date desc)
    from rows r
  ), '[]'::jsonb),
  'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'doc_id', doc_id, 'product', product, 'qty', qty, 'amount', amount) order by doc_id) from lines), '[]'::jsonb)
);
$function$;

revoke all on function public.report_sale_orders(uuid, text) from public, anon;
grant execute on function public.report_sale_orders(uuid, text) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_result jsonb;
  v_count int;
  v_value numeric;
  v_card_count numeric;
  v_card_value numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_sale_orders(v_company, 'pending') into v_result;
  select count(*), coalesce(sum((r->>'total')::numeric), 0) into v_count, v_value
    from jsonb_array_elements(v_result->'rows') r;

  select (public.dashboard_metrics() -> 'pending_sales_orders' ->> 'count')::numeric,
         (public.dashboard_metrics() -> 'pending_sales_orders' ->> 'value')::numeric
    into v_card_count, v_card_value;

  if v_count <> v_card_count then
    raise exception 'report_sale_orders self-check: pending count % does not match dashboard card count %', v_count, v_card_count;
  end if;
  if abs(v_value - v_card_value) > 0.01 then
    raise exception 'report_sale_orders self-check: pending value % does not match dashboard card value %', v_value, v_card_value;
  end if;

  raise notice 'report_sale_orders self-check passed: pending_count=%, pending_value=%', v_count, v_value;
end;
$chk$;
