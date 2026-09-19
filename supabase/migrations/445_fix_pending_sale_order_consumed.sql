-- A Sale Order's own "consumed" check counted ANY trade_documents child,
-- including a Purchase Order raised from it — but workflow_steps has BOTH
-- purchase_order and sales_invoice sourced from sale_order (two different
-- branches of the same chain: the internal procurement side and the
-- customer-facing sale side). That meant a Sale Order dropped off Pending
-- the moment its Purchase Order was raised, long before the customer was
-- ever actually invoiced — the owner had one genuinely pending Sale Order
-- (SO-00005, a PO raised against it but no invoice) reading as 0 pending
-- on the dashboard and as already in History on the Orders Report, because
-- both read the identical (deliberately kept in lockstep) definition.
--
-- Only a Sales Invoice (the sale's own fulfillment) or a non-cancelled car
-- contract (the car-flow equivalent, source_doc_id -> the Sale Order) now
-- counts as consuming a Sale Order. A Purchase Order's own "consumed" (an
-- MRN, or in the car flow a Purchase Voucher raised straight from it) is
-- unchanged — nothing else ever attaches a source_doc_id to a Purchase
-- Order, so the original "any child" check was already correct there.
create or replace function public.dashboard_metrics()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with
  co as (select auth_company_id() as id),
  bounds as (
    select date_trunc('month', current_date)::date as month_start,
           date_trunc('year',  current_date)::date as year_start,
           current_date as today
  ),
  cash_grp as (select path from accounts where company_id = (select id from co) and code = '1-02'),
  bank_grp as (select path from accounts where company_id = (select id from co) and code = '1-03'),
  gl as (
    select l.debit, l.credit, e.entry_date, a.type::text as acct_type, a.subtype,
           (a.subtype = 'Cash'
            or (a.path is not null and (select path from cash_grp) is not null
                and a.path like (select path from cash_grp) || '/%')) as is_cash,
           (a.subtype = 'Bank'
            or (a.path is not null and (select path from bank_grp) is not null
                and a.path like (select path from bank_grp) || '/%')) as is_bank
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join accounts a on a.id = l.account_id
    where e.status = 'posted' and e.company_id = (select id from co)
  ),
  open_ar_ap as (
    select
      (select coalesce(sum(g.debit - g.credit), 0) from gl g where g.subtype = 'Receivable') as ar,
      (select coalesce(sum(g.credit - g.debit), 0) from gl g where g.subtype = 'Payable') as ap,
      coalesce(sum(o.outstanding_base) filter (where o.direction = 'D' and o.due_date < current_date), 0) as ar_overdue,
      coalesce(sum(o.outstanding_base) filter (where o.direction = 'C' and o.due_date < current_date), 0) as ap_overdue
    from open_items o
    where o.status = 'open' and o.company_id = (select id from co)
  ),
  td as (
    select d.*,
           (case when d.doc_type = 'sale_order' then
              exists (select 1 from trade_documents x where x.source_doc_id = d.id and x.doc_type = 'sales_invoice')
              or exists (select 1 from car_contracts cc where cc.source_doc_id = d.id and cc.status <> 'cancelled')
            else
              exists (select 1 from trade_documents x where x.source_doc_id = d.id)
              or exists (select 1 from car_contracts cc where cc.source_doc_id = d.id)
            end) as consumed
    from trade_documents d where d.company_id = (select id from co)
  ),
  sales_docs as (
    select doc_date, total from td
     where doc_type in ('sales_invoice','air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice')
       and gl_entry is not null
    union all
    select contract_date, net_payable from car_contracts
     where company_id = (select id from co) and status in ('active','completed')
  ),
  so_pending as (
    select
      coalesce(sum(x.total), 0) as order_value,
      coalesce(sum(x.adv), 0)   as advance,
      coalesce(sum(x.rcv), 0)   as received
    from (
      select coalesce(d.total, 0) as total,
             case when d.meta->>'advance' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                  then (d.meta->>'advance')::numeric else 0 end as adv,
             coalesce((select sum(r.amount) from car_receipts r where r.source_doc_id = d.id), 0) as rcv
        from td d
       where d.doc_type = 'sale_order' and not d.consumed) x
  ),
  stock as (
    select coalesce(sum(b.qty), 0) as qty,
           coalesce(sum(b.value), 0) as value,
           count(distinct b.item_id) filter (where b.qty > 0) as items
    from stock_balances b where b.company_id = (select id from co)
  ),
  so_qty as (
    select coalesce(sum(l.quantity), 0) as q from trade_document_lines l
    join td on td.id = l.doc_id where td.doc_type = 'sale_order' and not td.consumed
  ),
  po_qty as (
    select coalesce(sum(l.quantity), 0) as q from trade_document_lines l
    join td on td.id = l.doc_id where td.doc_type = 'purchase_order' and not td.consumed
  ),
  stock_moves as (
    select
      coalesce(sum(m.qty) filter (where m.qty > 0 and m.doc_date >= (select month_start from bounds)), 0) as purchased_qty_month,
      coalesce(sum(-m.qty) filter (where m.qty < 0 and m.doc_date >= (select month_start from bounds)), 0) as sold_qty_month
    from stock_movements m
    join acct_products p on p.id = m.item_id
    where m.company_id = (select id from co) and not p.is_group
  ),
  cars as (
    select
      count(*) filter (where status = 'in_stock')  as in_stock,
      count(*) filter (where status = 'reserved')  as reserved,
      count(*) filter (where status = 'sold')      as sold,
      count(*) filter (where status = 'delivered') as delivered,
      count(*) filter (where status = 'held')      as held,
      count(*) as total
    from car_vehicles where company_id = (select id from co)
  ),
  car_due_items as (
    select i.due_date as due,
           greatest(i.amount - i.paid_amount, 0) as amt,
           coalesce(i.paid_amount, 0) as paid
      from car_installments i
      join car_contracts c on c.id = i.contract_id
     where c.company_id = (select id from co)
    union all
    select coalesce(c.advance_due_date, c.contract_date),
           greatest(coalesce(c.advance, 0) - coalesce(adv.paid, 0), 0),
           coalesce(adv.paid, 0)
      from car_contracts c
      left join lateral (
        select coalesce(sum(al.amount), 0) as paid
          from car_receipt_allocations al
          join car_receipts r on r.id = al.receipt_id
         where r.contract_id = c.id and al.target_type = 'advance') adv on true
     where c.company_id = (select id from co) and coalesce(c.advance, 0) > 0
    union all
    select s.due_date,
           greatest(s.amount - s.paid_amount, 0),
           coalesce(s.paid_amount, 0)
      from car_service_charges s
     where s.company_id = (select id from co)
  ),
  car_money as (
    select
      (select coalesce(sum(net_payable), 0) from car_contracts
        where company_id = (select id from co)) as sale_value,
      (select coalesce(sum(advance), 0) from car_contracts
        where company_id = (select id from co)) as advance,
      (select coalesce(sum(x.bal), 0) from (
         select a.id, coalesce(sum(l.debit - l.credit), 0) as bal
           from accounts a
           join journal_lines l on l.account_id = a.id
           join journal_entries e on e.id = l.entry_id and e.status = 'posted'
          where a.company_id = (select id from co)
            and a.party_id in (select customer_id from car_contracts
                                where company_id = (select id from co) and customer_id is not null)
          group by a.id) x) as balance,
      coalesce(sum(v.amt) filter (where v.due < (select month_start from bounds)), 0) as overdue,
      coalesce(sum(v.amt) filter (where v.due >= (select month_start from bounds)
                                    and v.due <= (select today from bounds)), 0) as due_this_month,
      coalesce(sum(v.paid), 0) as collected
    from car_due_items v
  ),
  hb as (
    select count(*) as total,
      count(*) filter (where status = 'pending')   as pending,
      count(*) filter (where status = 'confirmed') as confirmed,
      count(*) filter (where status = 'completed') as completed,
      count(*) filter (where status = 'cancelled') as cancelled,
      count(*) filter (where check_in = current_date and status <> 'cancelled') as checkin_today,
      count(*) filter (where check_out = current_date and status <> 'cancelled') as checkout_today,
      coalesce(sum(sale_total), 0) as sale_total
    from hotel_bookings where company_id = (select id from co)
  )
select jsonb_build_object(
  'as_of', (select today from bounds),
  'cash_bank', jsonb_build_object(
    'balance', (select coalesce(sum(debit - credit), 0) from gl where is_cash or is_bank),
    'cash',    (select coalesce(sum(debit - credit), 0) from gl where is_cash),
    'bank',    (select coalesce(sum(debit - credit), 0) from gl where is_bank)),
  'ar_ap', (select jsonb_build_object('ar', ar, 'ap', ap, 'overdue', ar_overdue,
                                      'ap_overdue', ap_overdue, 'net', ar - ap) from open_ar_ap),
  'sales', jsonb_build_object(
    'month', (select coalesce(sum(credit - debit), 0) from gl
               where acct_type = 'income' and entry_date >= (select month_start from bounds)),
    'year',  (select coalesce(sum(credit - debit), 0) from gl
               where acct_type = 'income' and entry_date >= (select year_start from bounds)),
    'total', (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'income'),
    'invoices_month', (select count(*) from td where doc_type = 'sales_invoice'
                        and doc_date >= (select month_start from bounds))),
  'expenses', jsonb_build_object(
    'month', (select coalesce(sum(debit - credit), 0) from gl
               where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS' and entry_date >= (select month_start from bounds)),
    'year',  (select coalesce(sum(debit - credit), 0) from gl
               where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS' and entry_date >= (select year_start from bounds)),
    'total', (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS')),
  'pnl', jsonb_build_object(
    'income_month',  (select coalesce(sum(credit - debit), 0) from gl
                       where acct_type = 'income' and entry_date >= (select month_start from bounds)),
    'cogs_month',    (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and subtype = 'COGS' and entry_date >= (select month_start from bounds)),
    'expense_month', (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS' and entry_date >= (select month_start from bounds)),
    'income_year',   (select coalesce(sum(credit - debit), 0) from gl
                       where acct_type = 'income' and entry_date >= (select year_start from bounds)),
    'cogs_year',     (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and subtype = 'COGS' and entry_date >= (select year_start from bounds)),
    'expense_year',  (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS' and entry_date >= (select year_start from bounds))),
  'balance_sheet', jsonb_build_object(
    'assets',      (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'asset'),
    'liabilities', (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'liability'),
    'equity',      (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'equity'),
    'profit',      (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'income')
                 - (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'expense'),
    'difference',  (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'asset')
                 - (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'liability')
                 - (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'equity')
                 - ((select coalesce(sum(credit - debit), 0) from gl where acct_type = 'income')
                    - (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'expense'))),
  'cash_flow', jsonb_build_object(
    'in_month',   (select coalesce(sum(debit), 0) from gl
                    where (is_cash or is_bank) and entry_date >= (select month_start from bounds)),
    'out_month',  (select coalesce(sum(credit), 0) from gl
                    where (is_cash or is_bank) and entry_date >= (select month_start from bounds)),
    'net_month',  (select coalesce(sum(debit - credit), 0) from gl
                    where (is_cash or is_bank) and entry_date >= (select month_start from bounds)),
    'in_year',    (select coalesce(sum(debit), 0) from gl
                    where (is_cash or is_bank) and entry_date >= (select year_start from bounds)),
    'out_year',   (select coalesce(sum(credit), 0) from gl
                    where (is_cash or is_bank) and entry_date >= (select year_start from bounds)),
    'net_year',   (select coalesce(sum(debit - credit), 0) from gl
                    where (is_cash or is_bank) and entry_date >= (select year_start from bounds))),
  'car_balances', (select jsonb_build_object('balance', balance, 'overdue', overdue,
                     'due_this_month', due_this_month, 'collected', collected,
                     'sale_value', sale_value, 'advance', advance) from car_money),
  'pending_sales_orders', jsonb_build_object(
    'count', (select count(*) from td where doc_type = 'sale_order' and not consumed),
    'value', (select coalesce(sum(total), 0) from td where doc_type = 'sale_order' and not consumed),
    'oldest', (select min(doc_date) from td where doc_type = 'sale_order' and not consumed)),
  'pending_purchase_orders', jsonb_build_object(
    'count', (select count(*) from td where doc_type = 'purchase_order' and not consumed),
    'value', (select coalesce(sum(total), 0) from td where doc_type = 'purchase_order' and not consumed),
    'oldest', (select min(doc_date) from td where doc_type = 'purchase_order' and not consumed)),
  'order_status', jsonb_build_object(
    'so_qty',    (select q from so_qty),
    'stock_qty', (select qty from stock),
    'po_qty',    (select q from po_qty),
    'balance',   (select (select qty from stock) + (select q from po_qty) - (select q from so_qty))),
  'so_advance_receipt', (select jsonb_build_object(
      'order_value', order_value,
      'advance',     advance,
      'received',    received,
      'balance',     advance - received) from so_pending),
  'purchase_vs_sale', jsonb_build_object(
    'purchased_qty_month', (select purchased_qty_month from stock_moves),
    'sold_qty_month',      (select sold_qty_month from stock_moves),
    'remaining_qty',       (select qty from stock)),
  'stock', (select jsonb_build_object('qty', qty, 'value', value, 'items', items) from stock),
  'bookings', (select jsonb_build_object('total', total, 'pending', pending, 'confirmed', confirmed,
                 'completed', completed, 'cancelled', cancelled, 'checkin_today', checkin_today,
                 'checkout_today', checkout_today, 'sale_total', sale_total) from hb),
  'delivery_status', (select jsonb_build_object(
      'sold', sold + delivered, 'delivered', delivered, 'balance', sold,
      'in_stock', in_stock, 'reserved', reserved, 'held', held, 'vehicles', total,
      'invoices',       (select count(*) from td where doc_type = 'sales_invoice'),
      'delivery_notes', (select count(*) from td where doc_type = 'delivery_note')) from cars)
);
$function$;

create or replace function public.report_sale_orders(p_company uuid, p_status text DEFAULT 'pending'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with td as (
  select d.*,
    (exists (select 1 from trade_documents x where x.source_doc_id = d.id and x.doc_type = 'sales_invoice')
     or exists (select 1 from car_contracts cc where cc.source_doc_id = d.id and cc.status <> 'cancelled')) as consumed
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
      'doc_id', doc_id, 'product', product, 'amount', amount) order by doc_id) from lines), '[]'::jsonb),
  'receipts', coalesce((select jsonb_agg(jsonb_build_object(
      'doc_id', doc_id, 'id', id, 'receipt_no', receipt_no, 'receipt_date', receipt_date, 'amount', amount) order by receipt_date) from receipts), '[]'::jsonb)
);
$function$;

do $chk$
declare
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_pending jsonb; v_dash jsonb;
  v_pending_count int; v_dash_count int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_sale_orders('96f6b539-b491-4df7-91a2-80c7c8e7491d', 'pending') into v_pending;
  select public.dashboard_metrics() into v_dash;

  v_pending_count := jsonb_array_length(v_pending->'rows');
  v_dash_count := (v_dash->'pending_sales_orders'->>'count')::int;

  if v_pending_count <> v_dash_count then
    raise exception 'mismatch: report_sale_orders pending rows=% dashboard count=%', v_pending_count, v_dash_count;
  end if;
end;
$chk$;
