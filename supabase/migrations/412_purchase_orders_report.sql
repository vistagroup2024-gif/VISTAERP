-- Purchase Orders had the same gap Sale Orders did — the dashboard's
-- Pending Purchase Orders card linked straight to the blank voucher editor.
-- "Received against" reuses the same consumed check dashboard_metrics()
-- already uses (a Purchase Voucher sourced from this PO exists), and
-- received_value sums whatever Purchase Vouchers were actually raised from
-- it — a PO can be partially received across more than one PV.
create or replace function public.report_purchase_orders(p_company uuid, p_status text default 'pending')
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with td as (
  select d.*,
    exists (select 1 from trade_documents x where x.source_doc_id = d.id) as consumed
  from trade_documents d
  where d.company_id = p_company and d.doc_type = 'purchase_order'
),
visible as (
  select d.id as doc_id from td d
  where case p_status when 'pending' then not d.consumed when 'history' then d.consumed else true end
),
received as (
  select pv.source_doc_id as doc_id, sum(pv.total) as received_value
  from trade_documents pv
  where pv.company_id = p_company and pv.doc_type = 'purchase_voucher' and pv.source_doc_id is not null
  group by pv.source_doc_id
),
rows as (
  select d.id as doc_id, d.doc_no, d.doc_date, d.delivery_date, d.cost_center, d.status, d.consumed,
    coalesce(p.name, 'Unspecified') as supplier, d.total,
    coalesce(r.received_value, 0) as received_value
  from td d
  join visible v on v.doc_id = d.id
  left join parties p on p.id = d.party_id
  left join received r on r.doc_id = d.id
),
lines as (
  select l.doc_id, coalesce(l.item_name, ap.name, 'Item') as product, sum(l.quantity) as qty, sum(l.amount) as amount, avg(l.rate) as rate
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
      'supplier', r.supplier, 'total', r.total,
      'received_value', r.received_value, 'balance_value', r.total - r.received_value
    ) order by r.doc_date desc)
    from rows r
  ), '[]'::jsonb),
  'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'doc_id', doc_id, 'product', product, 'qty', qty, 'rate', rate, 'amount', amount) order by doc_id) from lines), '[]'::jsonb)
);
$function$;

revoke all on function public.report_purchase_orders(uuid, text) from public, anon;
grant execute on function public.report_purchase_orders(uuid, text) to authenticated;

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

  select public.report_purchase_orders(v_company, 'pending') into v_result;
  select count(*), coalesce(sum((r->>'total')::numeric), 0) into v_count, v_value
    from jsonb_array_elements(v_result->'rows') r;

  select (public.dashboard_metrics() -> 'pending_purchase_orders' ->> 'count')::numeric,
         (public.dashboard_metrics() -> 'pending_purchase_orders' ->> 'value')::numeric
    into v_card_count, v_card_value;

  if v_count <> v_card_count then
    raise exception 'report_purchase_orders self-check: pending count % does not match dashboard card count %', v_count, v_card_count;
  end if;
  if abs(v_value - v_card_value) > 0.01 then
    raise exception 'report_purchase_orders self-check: pending value % does not match dashboard card value %', v_value, v_card_value;
  end if;

  raise notice 'report_purchase_orders self-check passed: pending_count=%, pending_value=%', v_count, v_value;
end;
$chk$;
