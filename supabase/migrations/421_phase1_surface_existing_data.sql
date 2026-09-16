-- Phase 1 of the reporting correction: surface data these RPCs already
-- compute (or that sits one join away on tables already posted to) but the
-- UI never showed. No new accounting logic, no duplicated calculations.

-- report_sale_orders: lines gain rate + current stock (stock_balances,
-- joined by product_id — 0 for a non-stock item such as a car, which is
-- correct: it was never tracked as inventory, not a lie). Rows gain terms
-- (Payment Terms) and due_date, both already columns on trade_documents.
create or replace function public.report_sale_orders(p_company uuid, p_status text default 'pending')
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
with td as (
  select d.*, (exists (select 1 from trade_documents x where x.source_doc_id = d.id) or exists (select 1 from car_contracts cc where cc.source_doc_id = d.id)) as consumed
  from trade_documents d where d.company_id = p_company and d.doc_type = 'sale_order'
),
visible as (select d.id as doc_id from td d where case p_status when 'pending' then not d.consumed when 'history' then d.consumed else true end),
rows as (
  select d.id as doc_id, d.doc_no, d.doc_date, d.delivery_date, d.cost_center, d.status, d.consumed, d.terms, d.due_date,
    coalesce(p.name, 'Unspecified') as customer, d.total,
    case when d.meta->>'advance' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then (d.meta->>'advance')::numeric else 0 end as advance,
    coalesce((select sum(r.amount) from car_receipts r where r.source_doc_id = d.id), 0) as advance_received
  from td d join visible v on v.doc_id = d.id left join parties p on p.id = d.party_id
),
lines_grouped as (
  select l.doc_id, l.product_id, coalesce(l.item_name, ap.name, 'Item') as product, sum(l.quantity) as qty, avg(l.rate) as rate, sum(l.amount) as amount
  from trade_document_lines l join visible v on v.doc_id = l.doc_id left join acct_products ap on ap.id = l.product_id
  group by l.doc_id, l.product_id, coalesce(l.item_name, ap.name, 'Item')
),
lines as (select lg.*, coalesce((select sum(sb.qty) from stock_balances sb where sb.item_id = lg.product_id), 0) as stock from lines_grouped lg)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(jsonb_build_object('doc_id', r.doc_id, 'doc_no', r.doc_no, 'doc_date', r.doc_date, 'delivery_date', r.delivery_date,
      'cost_centre', coalesce(r.cost_center, 'Unassigned'), 'status', r.status, 'consumed', r.consumed, 'terms', r.terms, 'due_date', r.due_date,
      'customer', r.customer, 'total', r.total, 'advance', r.advance, 'advance_received', r.advance_received, 'advance_balance', r.advance - r.advance_received)
    order by r.doc_date desc) from rows r), '[]'::jsonb),
  'lines', coalesce((select jsonb_agg(jsonb_build_object('doc_id', doc_id, 'product', product, 'qty', qty, 'rate', rate, 'amount', amount, 'stock', stock) order by doc_id) from lines), '[]'::jsonb)
);
$function$;

-- report_purchase_orders: lines gain stock, received_qty (matched against
-- the Purchase Vouchers already linked via source_doc_id, by product),
-- balance_qty, balance_value. Rows gain terms + due_date.
create or replace function public.report_purchase_orders(p_company uuid, p_status text default 'pending')
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
with td as (select d.*, exists (select 1 from trade_documents x where x.source_doc_id = d.id) as consumed from trade_documents d where d.company_id = p_company and d.doc_type = 'purchase_order'),
visible as (select d.id as doc_id from td d where case p_status when 'pending' then not d.consumed when 'history' then d.consumed else true end),
received as (select pv.source_doc_id as doc_id, sum(pv.total) as received_value from trade_documents pv where pv.company_id = p_company and pv.doc_type = 'purchase_voucher' and pv.source_doc_id is not null group by pv.source_doc_id),
rows as (
  select d.id as doc_id, d.doc_no, d.doc_date, d.delivery_date, d.cost_center, d.status, d.consumed, d.terms, d.due_date,
    coalesce(p.name, 'Unspecified') as supplier, d.total, coalesce(r.received_value, 0) as received_value
  from td d join visible v on v.doc_id = d.id left join parties p on p.id = d.party_id left join received r on r.doc_id = d.id
),
received_lines as (
  select pv.source_doc_id as po_doc_id, pvl.product_id, coalesce(pvl.item_name, 'Item') as product_key, sum(pvl.quantity) as recv_qty
  from trade_documents pv join trade_document_lines pvl on pvl.doc_id = pv.id
  where pv.company_id = p_company and pv.doc_type = 'purchase_voucher' and pv.source_doc_id is not null
  group by pv.source_doc_id, pvl.product_id, coalesce(pvl.item_name, 'Item')
),
lines_grouped as (
  select l.doc_id, l.product_id, coalesce(l.item_name, ap.name, 'Item') as product, sum(l.quantity) as qty, avg(l.rate) as rate, sum(l.amount) as amount
  from trade_document_lines l join visible v on v.doc_id = l.doc_id left join acct_products ap on ap.id = l.product_id
  group by l.doc_id, l.product_id, coalesce(l.item_name, ap.name, 'Item')
),
lines_raw as (
  select lg.*, coalesce((select sum(sb.qty) from stock_balances sb where sb.item_id = lg.product_id), 0) as stock,
    coalesce((select sum(rl.recv_qty) from received_lines rl where rl.po_doc_id = lg.doc_id
      and (rl.product_id = lg.product_id or (rl.product_id is null and lg.product_id is null and rl.product_key = lg.product))), 0) as received_qty
  from lines_grouped lg
),
lines as (select doc_id, product, qty, rate, amount, stock, received_qty, greatest(qty - received_qty, 0) as balance_qty, greatest(amount - rate * least(received_qty, qty), 0) as balance_value from lines_raw)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(jsonb_build_object('doc_id', r.doc_id, 'doc_no', r.doc_no, 'doc_date', r.doc_date, 'delivery_date', r.delivery_date,
      'cost_centre', coalesce(r.cost_center, 'Unassigned'), 'status', r.status, 'consumed', r.consumed, 'terms', r.terms, 'due_date', r.due_date,
      'supplier', r.supplier, 'total', r.total, 'received_value', r.received_value, 'balance_value', r.total - r.received_value)
    order by r.doc_date desc) from rows r), '[]'::jsonb),
  'lines', coalesce((select jsonb_agg(jsonb_build_object('doc_id', doc_id, 'product', product, 'qty', qty, 'rate', rate, 'amount', amount,
      'stock', stock, 'received_qty', received_qty, 'balance_qty', balance_qty, 'balance_value', balance_value) order by doc_id) from lines), '[]'::jsonb)
);
$function$;

revoke all on function public.report_sale_orders(uuid, text) from public, anon;
grant execute on function public.report_sale_orders(uuid, text) to authenticated;
revoke all on function public.report_purchase_orders(uuid, text) from public, anon;
grant execute on function public.report_purchase_orders(uuid, text) to authenticated;

-- report_sales: by_product used to LEFT JOIN trade_document_lines with
-- `and sd.is_trade` in the join predicate — for every car_contracts row
-- (is_trade = false) that predicate is false regardless of doc_id, so
-- `l.id is not null` filtered every car sale out. A vehicle sale must not
-- silently disappear from the product breakdown just because it has no
-- acct_products line — it needs its own branch reading car_vehicles, with
-- the same Product-Tree-item-first, make/model/variant/year fallback
-- vehicleTitle() already uses everywhere else in Car Sales.
create or replace function public.report_sales(p_company uuid, p_from date, p_to date)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
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
)
select jsonb_build_object(
  'total', (select coalesce(sum(total), 0) from sales_docs),
  'txns', (select count(*) from sales_docs),
  'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount, 'txns', txns) order by month), '[]'::jsonb) from by_month),
  'by_cost_centre', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_cc),
  'by_customer', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_customer),
  'by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'amount', amount) order by amount desc), '[]'::jsonb) from by_product)
);
$function$;

revoke all on function public.report_sales(uuid, date, date) from public, anon;
grant execute on function public.report_sales(uuid, date, date) to authenticated;

-- report_customer_monthwise: the same This/Last/2-ago/3-ago/Older bucket
-- shape car_customer_monthwise() already uses, generalised off journal_lines
-- for ANY receivable/payable account — debit=billed, credit=received, the
-- same convention every other report already reads a receivable by.
create or replace function public.report_customer_monthwise(p_company uuid, p_account_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
with bounds as (
  select date_trunc('month', current_date)::date as m0,
         (date_trunc('month', current_date) - interval '1 month')::date as m1,
         (date_trunc('month', current_date) - interval '2 month')::date as m2,
         (date_trunc('month', current_date) - interval '3 month')::date as m3
),
gl as (
  select date_trunc('month', e.entry_date)::date as mth, l.debit, l.credit
  from journal_lines l join journal_entries e on e.id = l.entry_id
  where e.company_id = p_company and e.status = 'posted' and l.account_id = p_account_id
),
billed_by_month as (select mth, sum(debit) as amt from gl group by 1),
received_by_month as (select mth, sum(credit) as amt from gl group by 1)
select jsonb_build_object(
  'billed_cur',    coalesce((select amt from billed_by_month where mth = (select m0 from bounds)), 0),
  'billed_last',   coalesce((select amt from billed_by_month where mth = (select m1 from bounds)), 0),
  'billed_l2',     coalesce((select amt from billed_by_month where mth = (select m2 from bounds)), 0),
  'billed_l3',     coalesce((select amt from billed_by_month where mth = (select m3 from bounds)), 0),
  'billed_prev',   coalesce((select sum(amt) from billed_by_month where mth < (select m3 from bounds)), 0),
  'received_cur',  coalesce((select amt from received_by_month where mth = (select m0 from bounds)), 0),
  'received_last', coalesce((select amt from received_by_month where mth = (select m1 from bounds)), 0),
  'received_l2',   coalesce((select amt from received_by_month where mth = (select m2 from bounds)), 0),
  'received_l3',   coalesce((select amt from received_by_month where mth = (select m3 from bounds)), 0)
);
$function$;

revoke all on function public.report_customer_monthwise(uuid, uuid) from public, anon;
grant execute on function public.report_customer_monthwise(uuid, uuid) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_so jsonb; v_po jsonb; v_sales jsonb; v_mw jsonb;
  v_so_count numeric; v_so_value numeric; v_card_so_count numeric; v_card_so_value numeric;
  v_po_count numeric; v_po_value numeric; v_card_po_count numeric; v_card_po_value numeric;
  v_bp_sum numeric; v_total numeric;
  v_test_account uuid; v_mw_sum numeric; v_gl_total numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_sale_orders(v_company, 'pending') into v_so;
  select count(*), coalesce(sum((r->>'total')::numeric),0) into v_so_count, v_so_value from jsonb_array_elements(v_so->'rows') r;
  select (public.dashboard_metrics()->'pending_sales_orders'->>'count')::numeric, (public.dashboard_metrics()->'pending_sales_orders'->>'value')::numeric
    into v_card_so_count, v_card_so_value;
  if v_so_count <> v_card_so_count or abs(v_so_value - v_card_so_value) > 0.01 then
    raise exception 'report_sale_orders self-check failed: % / % vs % / %', v_so_count, v_so_value, v_card_so_count, v_card_so_value;
  end if;

  select public.report_purchase_orders(v_company, 'pending') into v_po;
  select count(*), coalesce(sum((r->>'total')::numeric),0) into v_po_count, v_po_value from jsonb_array_elements(v_po->'rows') r;
  select (public.dashboard_metrics()->'pending_purchase_orders'->>'count')::numeric, (public.dashboard_metrics()->'pending_purchase_orders'->>'value')::numeric
    into v_card_po_count, v_card_po_value;
  if v_po_count <> v_card_po_count or abs(v_po_value - v_card_po_value) > 0.01 then
    raise exception 'report_purchase_orders self-check failed: % / % vs % / %', v_po_count, v_po_value, v_card_po_count, v_card_po_value;
  end if;

  select public.report_sales(v_company, '2000-01-01', current_date) into v_sales;
  select coalesce(sum((r->>'amount')::numeric), 0) into v_bp_sum from jsonb_array_elements(v_sales->'by_product') r;
  v_total := (v_sales->>'total')::numeric;
  if abs(v_bp_sum - v_total) > 0.01 then
    raise exception 'report_sales self-check failed: by_product sum % does not match total %', v_bp_sum, v_total;
  end if;

  select account_id into v_test_account
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
   where e.company_id = v_company and e.status = 'posted' and a.subtype = 'Receivable'
   group by account_id order by count(*) desc limit 1;
  if v_test_account is not null then
    select public.report_customer_monthwise(v_company, v_test_account) into v_mw;
    select (v_mw->>'billed_cur')::numeric + (v_mw->>'billed_last')::numeric + (v_mw->>'billed_l2')::numeric
         + (v_mw->>'billed_l3')::numeric + (v_mw->>'billed_prev')::numeric into v_mw_sum;
    select coalesce(sum(l.debit), 0) into v_gl_total
      from journal_lines l join journal_entries e on e.id = l.entry_id
     where e.company_id = v_company and e.status = 'posted' and l.account_id = v_test_account;
    if abs(v_mw_sum - v_gl_total) > 0.01 then
      raise exception 'report_customer_monthwise self-check failed: % vs %', v_mw_sum, v_gl_total;
    end if;
  end if;

  raise notice 'phase 1 self-check passed: SO %/%, PO %/%, by_product_sum=%, monthwise_ok=%',
    v_so_count, v_so_value, v_po_count, v_po_value, v_bp_sum, v_test_account is not null;
end;
$chk$;
