-- Phase 6: fix the genuine gaps the report-by-report audit found in SO
-- Advance vs Receipt, Delivery Status, Purchase Report, Drawings and
-- Targets & Budget. Stock and Transport/Bookings were audited and found
-- already complete — untouched here, per "do not rebuild reports that are
-- already complete."

-- ── report_customer_targets: was reading open_items for "actual", which is
-- exactly the trap this project's own dashboard-card fix (Sept 2026, see
-- CLAUDE.md) already found and moved away from — a car sale, a visa
-- invoice, a transport charge and a hotel booking all debit the customer's
-- account directly, and open_items is a parallel, narrower definition of
-- "sale" that can (and here does, by 500 SAR against live data) disagree
-- with report_sales()'s own total for the same period. Source "actual" from
-- report_sales()'s own by_customer instead — reusing the already-verified
-- calculation rather than re-deriving a third definition — so this tab can
-- never again show a different number than the Sales Report for the same
-- customer. Adds account_id so the UI can drill a row to that customer's
-- ledger (report_cost_center_targets already sums straight off posted
-- income-account journal lines by cost_center, which is at least as
-- complete a definition as report_sales() and already agreed with it on
-- live data — left unchanged).
create or replace function public.report_customer_targets(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with sales as (
  select (r->>'account_id')::uuid as account_id, (r->>'amount')::numeric as amount
  from jsonb_array_elements(public.report_sales(auth_company_id(), p_from, p_to) -> 'by_customer') r
  where (r->>'account_id') is not null
)
select coalesce(jsonb_agg(jsonb_build_object(
    'customer', p.name, 'account_id', acc.id,
    'target', p.sales_target, 'actual', coalesce(s.amount,0),
    'variance', coalesce(s.amount,0) - p.sales_target) order by p.name), '[]'::jsonb)
from parties p
left join accounts acc on acc.party_id = p.id
left join sales s on s.account_id = acc.id
where p.company_id = auth_company_id() and p.is_active and p.party_type in ('customer','b2b_agent')
  and (p.sales_target > 0 or coalesce(s.amount,0) > 0);
$function$;

revoke all on function public.report_customer_targets(date, date) from public, anon;
grant execute on function public.report_customer_targets(date, date) to authenticated;

-- ── report_sale_orders: Advance vs Receipt showed one lump "Received" sum
-- per order with no way to see which receipt(s) it came from. Add the
-- actual receipt rows per order (same car_receipts.source_doc_id join the
-- existing advance_received sum already uses), so the report can show them
-- the way Phase 1 already made Pending SO/PO show their lines: expandable,
-- not just a total.
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
),
receipts as (
  select r.source_doc_id as doc_id, r.id, r.receipt_no, r.receipt_date, r.amount
  from car_receipts r
  join visible v on v.doc_id = r.source_doc_id
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
      'doc_id', doc_id, 'product', product, 'qty', qty, 'amount', amount) order by doc_id) from lines), '[]'::jsonb),
  'receipts', coalesce((select jsonb_agg(jsonb_build_object(
      'doc_id', doc_id, 'id', id, 'receipt_no', receipt_no, 'receipt_date', receipt_date, 'amount', amount) order by receipt_date) from receipts), '[]'::jsonb)
);
$function$;

revoke all on function public.report_sale_orders(uuid, text) from public, anon;
grant execute on function public.report_sale_orders(uuid, text) to authenticated;

-- ── report_car_delivery: Delivery Status had no filter (always "all time,
-- every sold vehicle") and Invoice No was plain text with no link, even
-- though the contract it names has its own detail page. Adds an optional
-- date-range (on the invoice/contract date) and contract_id so the UI can
-- link straight to it. Signature grows two optional params -> the old
-- 1-arg overload must be dropped first or Postgres keeps both and future
-- calls become ambiguous (same trap as report_cash_bank, migration 422).
drop function if exists public.report_car_delivery(uuid);

create or replace function public.report_car_delivery(p_company uuid, p_from date default null, p_to date default null)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle_id', v.id, 'contract_id', c.id,
    'item', ap.name, 'make', v.make, 'model', v.model, 'variant', v.variant, 'model_year', v.model_year,
    'plate_no', v.plate_no, 'status', v.status,
    'customer', p.name, 'cost_centre', c.cost_center, 'tag_area', c.tag_area,
    'invoice_no', c.contract_no, 'invoice_date', c.contract_date, 'invoice_amount', c.net_payable,
    'delivered', v.status = 'delivered'
  ) order by c.contract_date desc nulls last, v.vehicle_no), '[]'::jsonb)
from car_vehicles v
left join car_contracts c on c.id = v.contract_id
left join parties p on p.id = coalesce(c.customer_id, v.current_customer_id)
left join acct_products ap on ap.id = v.product_id
where v.company_id = p_company
  and (v.status not in ('sold', 'delivered')
       or (p_from is null or c.contract_date >= p_from) and (p_to is null or c.contract_date <= p_to));
$function$;

revoke all on function public.report_car_delivery(uuid, date, date) from public, anon;
grant execute on function public.report_car_delivery(uuid, date, date) to authenticated;

-- ── report_purchases: By Supplier had no way to open the supplier's ledger
-- (every other "by party" breakdown built in this project links through —
-- Sales Report's by_customer, the Aging report, the Cash & Bank hierarchy).
-- Adds account_id the same way report_sales()'s by_customer already does.
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
  select coalesce(p.name, 'Unspecified') as name, acc.id as account_id, sum(pd.total) as amount, count(*) as txns
  from purch_docs pd left join parties p on p.id = pd.supplier_id
  left join accounts acc on acc.party_id = p.id
  group by 1, 2
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
  'by_supplier', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'account_id', account_id, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_supplier),
  'by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'amount', amount) order by amount desc), '[]'::jsonb) from by_product)
);
$function$;

revoke all on function public.report_purchases(uuid, date, date) from public, anon;
grant execute on function public.report_purchases(uuid, date, date) to authenticated;

-- ── report_drawings: neither "By Account" nor "Vouchers" linked anywhere,
-- even though every other by-account breakdown in this project does. Adds
-- account_id to both.
create or replace function public.report_drawings(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with dr as (
  select l.account_id, a.name as account, e.entry_no as voucher, e.entry_date as date,
    l.debit - l.credit as amount, l.description as remarks,
    (select a2.name from journal_lines l2 join accounts a2 on a2.id = l2.account_id
       where l2.entry_id = e.id and l2.id <> l.id order by l2.credit desc limit 1) as credit_account
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  where e.company_id = p_company and e.status = 'posted' and a.subtype = 'Drawing'
    and e.entry_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
)
select jsonb_build_object(
  'total', coalesce((select sum(amount) from dr), 0),
  'by_account', (select coalesce(jsonb_agg(jsonb_build_object('name', account, 'account_id', account_id, 'amount', s) order by s desc), '[]'::jsonb)
                 from (select account, account_id, sum(amount) as s from dr group by account, account_id) x),
  'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'amount', s) order by m), '[]'::jsonb)
              from (select to_char(date, 'YYYY-MM') as m, sum(amount) as s from dr group by 1) y),
  'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'voucher', voucher, 'date', date, 'account', account, 'account_id', account_id, 'amount', amount,
      'credit_account', credit_account, 'remarks', remarks
    ) order by date desc), '[]'::jsonb) from dr)
);
$function$;

revoke all on function public.report_drawings(uuid, date, date) from public, anon;
grant execute on function public.report_drawings(uuid, date, date) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_ct_sum numeric;
  v_direct_sum numeric;
  v_so jsonb;
  v_rows_advrecv numeric; v_receipts_sum numeric;
  v_delivery jsonb;
  v_card_delivered numeric; v_card_sold numeric; v_delivered int; v_sold int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  -- report_customer_targets: independently recompute "actual sales per real
  -- customer/agent party" straight off trade_documents + car_contracts (the
  -- same definition report_sales() uses) and compare — this is the fix for
  -- the 500 SAR drift the open_items-based version showed against live data.
  select coalesce(sum((r->>'actual')::numeric),0) into v_ct_sum
  from jsonb_array_elements(public.report_customer_targets('2000-01-01', current_date)) r;

  select coalesce(sum(x.amt), 0) into v_direct_sum
  from (
    select p.id,
      coalesce((select sum(d.total) from trade_documents d
         where d.company_id = v_company and d.party_id = p.id
           and d.doc_type in ('sales_invoice','air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice')
           and d.gl_entry is not null), 0)
      + coalesce((select sum(c.net_payable) from car_contracts c
         where c.company_id = v_company and c.customer_id = p.id and c.status in ('active','completed')), 0)
      as amt
    from parties p
    where p.company_id = v_company and p.is_active and p.party_type in ('customer','b2b_agent')
  ) x;

  if abs(v_ct_sum - v_direct_sum) > 0.01 then
    raise exception 'report_customer_targets self-check: actual sum % does not match direct trade_documents+car_contracts sum %', v_ct_sum, v_direct_sum;
  end if;

  -- report_sale_orders: the new receipts list must foot to the same
  -- advance_received each row already carried (two independent aggregations
  -- of the same car_receipts rows, grouped the same way).
  select public.report_sale_orders(v_company, 'all') into v_so;
  select coalesce(sum((r->>'advance_received')::numeric),0) into v_rows_advrecv from jsonb_array_elements(v_so->'rows') r;
  select coalesce(sum((r->>'amount')::numeric),0) into v_receipts_sum from jsonb_array_elements(v_so->'receipts') r;
  if abs(v_rows_advrecv - v_receipts_sum) > 0.01 then
    raise exception 'report_sale_orders self-check: rows advance_received sum % does not match receipts amount sum %', v_rows_advrecv, v_receipts_sum;
  end if;

  -- report_car_delivery: unchanged against the dashboard card with no date
  -- filter applied (the card itself has none), same check as migration 414.
  select public.report_car_delivery(v_company) into v_delivery;
  select count(*) filter (where r->>'delivered' = 'true'),
         count(*) filter (where r->>'status' in ('sold', 'delivered'))
    into v_delivered, v_sold
  from jsonb_array_elements(v_delivery) r;
  select (public.dashboard_metrics() -> 'delivery_status' ->> 'delivered')::numeric,
         (public.dashboard_metrics() -> 'delivery_status' ->> 'sold')::numeric
    into v_card_delivered, v_card_sold;
  if v_delivered <> v_card_delivered or v_sold <> v_card_sold then
    raise exception 'report_car_delivery self-check: delivered/sold %/% does not match dashboard card %/%', v_delivered, v_sold, v_card_delivered, v_card_sold;
  end if;

  raise notice 'phase 6 self-check passed: customer_targets_actual=% (was 500 off via open_items), so_receipts_sum=%, delivery delivered=%/sold=%',
    v_ct_sum, v_receipts_sum, v_delivered, v_sold;
end;
$chk$;
