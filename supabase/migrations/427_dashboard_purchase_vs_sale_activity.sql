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
           (exists (select 1 from trade_documents x where x.source_doc_id = d.id)
            or exists (select 1 from car_contracts cc where cc.source_doc_id = d.id)) as consumed
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
  -- Purchase vs Sale is a TRADING ACTIVITY card, not a second P&L: nothing
  -- here repeats what the Sales, Expenses or P&L cards already show. Buy
  -- value has no other card; the two transaction counts (added here) are
  -- the "how much happened" quantity read, the same reasoning the business
  -- asked for applied to a whole-company card rather than one product line.
  'purchase_vs_sale', jsonb_build_object(
    'purchase_month', (select coalesce(sum(total), 0) from td
                        where doc_type = 'purchase_voucher' and gl_entry is not null and doc_date >= (select month_start from bounds)),
    'purchase_txns_month', (select count(*) from td
                        where doc_type = 'purchase_voucher' and gl_entry is not null and doc_date >= (select month_start from bounds)),
    'sale_txns_month', (select count(*) from sales_docs where doc_date >= (select month_start from bounds)),
    'purchase_year',  (select coalesce(sum(total), 0) from td
                        where doc_type = 'purchase_voucher' and gl_entry is not null and doc_date >= (select year_start from bounds)),
    'purchase_txns_year', (select count(*) from td
                        where doc_type = 'purchase_voucher' and gl_entry is not null and doc_date >= (select year_start from bounds)),
    'sale_txns_year', (select count(*) from sales_docs where doc_date >= (select year_start from bounds))),
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

revoke all on function public.dashboard_metrics() from public, anon;
grant execute on function public.dashboard_metrics() to authenticated;

do $chk$
declare
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_result jsonb;
  v_pvs jsonb;
  v_purchase_txns numeric; v_direct_purchase_txns numeric;
  v_sale_txns numeric; v_direct_sale_txns numeric;
  v_month_start date := date_trunc('month', current_date)::date;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.dashboard_metrics() into v_result;
  v_pvs := v_result -> 'purchase_vs_sale';
  v_purchase_txns := (v_pvs->>'purchase_txns_month')::numeric;
  v_sale_txns := (v_pvs->>'sale_txns_month')::numeric;

  select count(*) into v_direct_purchase_txns
  from trade_documents d
  where d.company_id = v_company and d.doc_type = 'purchase_voucher' and d.gl_entry is not null
    and d.doc_date >= v_month_start;

  select count(*) into v_direct_sale_txns
  from (
    select doc_date from trade_documents d
     where d.company_id = v_company
       and d.doc_type in ('sales_invoice','air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice')
       and d.gl_entry is not null
    union all
    select contract_date from car_contracts
     where company_id = v_company and status in ('active','completed')
  ) x where x.doc_date >= v_month_start;

  if v_purchase_txns <> v_direct_purchase_txns then
    raise exception 'purchase_txns_month self-check: % does not match direct count %', v_purchase_txns, v_direct_purchase_txns;
  end if;
  if v_sale_txns <> v_direct_sale_txns then
    raise exception 'sale_txns_month self-check: % does not match direct count %', v_sale_txns, v_direct_sale_txns;
  end if;

  raise notice 'dashboard_metrics purchase_vs_sale self-check passed: purchase_txns_month=%, sale_txns_month=%', v_purchase_txns, v_sale_txns;
end;
$chk$;
