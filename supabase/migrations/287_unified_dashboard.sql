-- 287 One dashboard, and per-card access.
--
-- The cards were spread over five module dashboards (/accounting, /car-sales,
-- /hotels/dashboard, /inventory, /transport) plus the main one, so seeing the
-- business meant visiting six screens. Every figure the cards need is now
-- computed in ONE call, and each card can be granted per user.
--
-- dashboard_metrics() is security INVOKER on purpose (see CLAUDE.md): it is a
-- report, so row-level security reaches it and a user restricted to certain
-- accounts or products sees a dashboard built from only those.

alter table profiles
  add column if not exists dashboard_cards jsonb not null default '{}'::jsonb;

comment on column profiles.dashboard_cards is
  'Which dashboard cards this user may see: {"cash_bank": true, ...}. Unlike the other access maps an EMPTY map grants NOTHING here — only an admin sees every card, everyone else sees what has been ticked.';

create or replace function public.dashboard_metrics()
returns jsonb language sql stable security invoker set search_path to 'public' as $$
with
  co as (select auth_company_id() as id),
  bounds as (
    select date_trunc('month', current_date)::date as month_start,
           date_trunc('year',  current_date)::date as year_start,
           current_date as today
  ),
  -- Posted general-ledger lines, with the account they touch.
  gl as (
    select l.debit, l.credit, e.entry_date, a.type::text as acct_type, a.subtype
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join accounts a on a.id = l.account_id
    where e.status = 'posted' and e.company_id = (select id from co)
  ),
  open_ar_ap as (
    select
      coalesce(sum(outstanding_base) filter (where direction = 'D'), 0) as ar,
      coalesce(sum(outstanding_base) filter (where direction = 'C'), 0) as ap,
      coalesce(sum(outstanding_base) filter (where direction = 'D' and due_date < current_date), 0) as ar_overdue,
      coalesce(sum(outstanding_base) filter (where direction = 'C' and due_date < current_date), 0) as ap_overdue
    from open_items where status = 'open'
  ),
  -- Trade documents, by type. `open` = not yet pulled into a downstream document.
  td as (
    select d.*, exists (select 1 from trade_documents x where x.source_doc_id = d.id) as consumed
    from trade_documents d where d.company_id = (select id from co)
  ),
  stock as (
    select coalesce(sum(b.qty), 0) as qty,
           coalesce(sum(b.value), 0) as value,
           count(distinct b.item_id) filter (where b.qty > 0) as items
    from stock_balances b where b.company_id = (select id from co)
  ),
  -- Ordered / on order, in quantity, for the SO vs stock vs PO balance.
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
  car_money as (
    select
      coalesce(sum(c.sale_price), 0) as sale_value,
      coalesce(sum(c.advance), 0)    as advance,
      coalesce(sum(i.amount - i.paid_amount) filter (where i.amount > i.paid_amount), 0) as outstanding,
      coalesce(sum(i.amount - i.paid_amount) filter (where i.amount > i.paid_amount and i.due_date < current_date), 0) as overdue,
      coalesce(sum(i.amount - i.paid_amount) filter (where i.amount > i.paid_amount
               and i.due_date >= (select month_start from bounds)
               and i.due_date <  ((select month_start from bounds) + interval '1 month')), 0) as due_this_month,
      coalesce(sum(i.paid_amount), 0) as collected
    from car_contracts c left join car_installments i on i.contract_id = c.id
    where c.company_id = (select id from co)
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
    'balance', (select coalesce(sum(debit - credit), 0) from gl where subtype in ('Cash', 'Bank')),
    'cash',    (select coalesce(sum(debit - credit), 0) from gl where subtype = 'Cash'),
    'bank',    (select coalesce(sum(debit - credit), 0) from gl where subtype = 'Bank')),

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
               where acct_type = 'expense' and entry_date >= (select month_start from bounds)),
    'year',  (select coalesce(sum(debit - credit), 0) from gl
               where acct_type = 'expense' and entry_date >= (select year_start from bounds)),
    'total', (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'expense')),

  'pnl', jsonb_build_object(
    'income_month',  (select coalesce(sum(credit - debit), 0) from gl
                       where acct_type = 'income' and entry_date >= (select month_start from bounds)),
    'expense_month', (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and entry_date >= (select month_start from bounds)),
    'income_year',   (select coalesce(sum(credit - debit), 0) from gl
                       where acct_type = 'income' and entry_date >= (select year_start from bounds)),
    'expense_year',  (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and entry_date >= (select year_start from bounds))),

  'car_balances', (select jsonb_build_object('outstanding', outstanding, 'overdue', overdue,
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

  -- Ordered against what can fill it: stock on hand plus what is on order.
  'order_status', jsonb_build_object(
    'so_qty',    (select q from so_qty),
    'stock_qty', (select qty from stock),
    'po_qty',    (select q from po_qty),
    'balance',   (select (select qty from stock) + (select q from po_qty) - (select q from so_qty))),

  -- What the orders are worth against what has actually been received for them.
  'so_advance_receipt', jsonb_build_object(
    'order_value', (select coalesce(sum(total), 0) from td where doc_type = 'sale_order'),
    'advance',     (select advance from car_money),
    'received',    (select collected from car_money),
    'balance',     (select coalesce(sum(total), 0) from td where doc_type = 'sale_order')
                   - (select advance + collected from car_money)),

  'purchase_vs_sale', jsonb_build_object(
    'purchase_month', (select coalesce(sum(total), 0) from td
                        where doc_type = 'purchase_voucher' and doc_date >= (select month_start from bounds)),
    'sale_month',     (select coalesce(sum(total), 0) from td
                        where doc_type = 'sales_invoice' and doc_date >= (select month_start from bounds)),
    'purchase_year',  (select coalesce(sum(total), 0) from td
                        where doc_type = 'purchase_voucher' and doc_date >= (select year_start from bounds)),
    'sale_year',      (select coalesce(sum(total), 0) from td
                        where doc_type = 'sales_invoice' and doc_date >= (select year_start from bounds))),

  'stock', (select jsonb_build_object('qty', qty, 'value', value, 'items', items) from stock),

  'bookings', (select jsonb_build_object('total', total, 'pending', pending, 'confirmed', confirmed,
                 'completed', completed, 'cancelled', cancelled, 'checkin_today', checkin_today,
                 'checkout_today', checkout_today, 'sale_total', sale_total) from hb),

  -- Cars sold and how many have actually left, plus the trade side (an invoice
  -- raised against a delivery note issued).
  'delivery_status', (select jsonb_build_object(
      'sold', sold + delivered, 'delivered', delivered, 'balance', sold,
      'in_stock', in_stock, 'reserved', reserved, 'held', held, 'vehicles', total,
      'invoices',       (select count(*) from td where doc_type = 'sales_invoice'),
      'delivery_notes', (select count(*) from td where doc_type = 'delivery_note')) from cars)
);
$$;

revoke all on function public.dashboard_metrics() from anon;

-- ── per-card access ─────────────────────────────────────────────────────────
-- The one place the "empty means unrestricted" convention is deliberately
-- reversed, because the ask was explicit: only an admin sees every card, and
-- everyone else sees exactly what has been ticked for them.
create or replace function public.staff_dashboard_cards()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when has_role('admin') then '"all"'::jsonb
              else coalesce((select dashboard_cards from profiles where id = auth.uid()), '{}'::jsonb) end;
$$;

create or replace function public.staff_user_access(p_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'doc_rights',    coalesce(p.doc_rights, '{}'::jsonb),
    'scope_exclude', coalesce(p.scope_exclude, '{}'::jsonb),
    'dashboard_cards', coalesce(p.dashboard_cards, '{}'::jsonb),
    'login_date_from', p.login_date_from, 'login_date_to', p.login_date_to,
    'login_time_from', p.login_time_from, 'login_time_to', p.login_time_to,
    'scopes', coalesce((
      select jsonb_object_agg(kind, ids) from (
        select kind, jsonb_agg(ref_id) as ids from staff_scopes where user_id = p.id group by kind
      ) s), '{}'::jsonb)
  )
  from profiles p
  where p.id = p_id and p.company_id = auth_company_id() and staff_perm_strict('users.manage_roles');
$$;

-- The setter gains the card map. Its signature changes, so the old one goes.
drop function if exists public.staff_user_set_access(uuid, jsonb, jsonb, jsonb, date, date, time, time);
create or replace function public.staff_user_set_access(
  p_id uuid, p_doc_rights jsonb, p_scopes jsonb, p_scope_exclude jsonb,
  p_login_date_from date, p_login_date_to date,
  p_login_time_from time, p_login_time_to time,
  p_dashboard_cards jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_kind text; v_id uuid;
begin
  perform staff_admin_guard(p_id, 'users.manage_roles');

  update profiles set
    doc_rights      = coalesce(p_doc_rights, '{}'::jsonb),
    scope_exclude   = coalesce(p_scope_exclude, '{}'::jsonb),
    dashboard_cards = coalesce(p_dashboard_cards, '{}'::jsonb),
    login_date_from = p_login_date_from,
    login_date_to   = p_login_date_to,
    login_time_from = p_login_time_from,
    login_time_to   = p_login_time_to
  where id = p_id;

  delete from staff_scopes where user_id = p_id;
  for v_kind in select jsonb_object_keys(coalesce(p_scopes, '{}'::jsonb)) loop
    if v_kind not in ('account', 'product', 'cost_center', 'tag_area') then
      raise exception 'Unknown restriction %', v_kind;
    end if;
    for v_id in select (jsonb_array_elements_text(p_scopes -> v_kind))::uuid loop
      insert into staff_scopes(user_id, kind, ref_id) values (p_id, v_kind, v_id)
      on conflict do nothing;
    end loop;
  end loop;
end $$;

revoke all on function public.staff_user_set_access(uuid, jsonb, jsonb, jsonb, date, date, time, time, jsonb) from anon;

-- staff_access() carries the card map so the dashboard knows what to render.
create or replace function public.staff_access()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'is_admin',    has_role('admin'),
    'full_name',   (select full_name from profiles where id = auth.uid()),
    'permissions', coalesce((select permissions from profiles where id = auth.uid()), '{}'::jsonb),
    'doc_rights',  coalesce((select doc_rights  from profiles where id = auth.uid()), '{}'::jsonb),
    'dashboard_cards', staff_dashboard_cards(),
    'login_ok',    staff_login_ok(),
    'is_active',   coalesce((select is_active from profiles where id = auth.uid()), false),
    'login_window', (select jsonb_build_object(
                       'date_from', login_date_from, 'date_to', login_date_to,
                       'time_from', login_time_from, 'time_to', login_time_to)
                     from profiles where id = auth.uid())
  );
$$;
