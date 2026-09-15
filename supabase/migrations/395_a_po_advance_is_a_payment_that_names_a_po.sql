-- 395 — A Purchase Order advance is a Payment like any other; it just names a
-- PO instead of a ledger account, and settles the bill the Purchase Voucher
-- raises once it exists. Mirrors the car module's Sale Order advance
-- (migration 338/387), but goes through the SAME acct_approval_rules gate a
-- normal Payment voucher does — car advances bypass that gate on purpose
-- (money coming in has one door of its own), a supplier advance does not:
-- typed as a plain Payment line today, it is already checked against the
-- rules, and a second door that skips them would be a regression, not a
-- convenience.

-- ── what an advance is against ──────────────────────────────────────────────
create table if not exists po_advances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  source_doc_id uuid not null references trade_documents(id) on delete restrict,   -- the Purchase Order
  entry_id uuid not null references journal_entries(id) on delete restrict,        -- the Payment's own posted entry
  supplier_id uuid references parties(id) on delete set null,
  amount numeric(18,2) not null default 0,
  adopted_item_id uuid references open_items(id) on delete set null,               -- the bill it settled, once one exists
  adopted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists po_advances_source_idx on po_advances(source_doc_id);
alter table po_advances enable row level security;
drop policy if exists po_advances_staff on po_advances;
create policy po_advances_staff on po_advances for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

-- ── the picker: Purchase Orders still waiting for their Purchase Voucher ───
create or replace function public.po_pending_advance()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
    'party_name', (select p.name from parties p where p.id = d.party_id),
    'cost_center', d.cost_center, 'reference', d.reference, 'total', d.total,
    'advanced', coalesce((select sum(a.amount) from po_advances a where a.source_doc_id = d.id), 0))
    order by d.doc_date desc, d.doc_no desc), '[]'::jsonb)
  from trade_documents d
  where d.company_id = auth_company_id()
    and d.doc_type = 'purchase_order'
    and coalesce(d.status, 'open') not in ('cancelled', 'closed')
    and not exists (
      select 1 from trade_documents t
      where t.company_id = d.company_id and t.doc_type = 'purchase_voucher' and t.source_doc_id = d.id);
$function$;
revoke all on function public.po_pending_advance() from public, anon;
grant execute on function public.po_pending_advance() to authenticated;

-- ── the save: a Payment shaped exactly like gl_payment's own, one line, the
-- supplier the PO names — through gl_submit, so acct_approval_rules is
-- checked exactly as it is for a Payment typed by hand. The PO id rides in
-- gl_submit's payload, the same seat apply_billwise_allocations already uses
-- for its own lines, so it survives into pending_vouchers and is still there
-- for voucher_approve to read if the rule holds this one for approval. ────
create or replace function public.po_payment_save(
  p_company uuid, p_date date, p_cash_bank uuid, p_source_doc_id uuid,
  p_amount numeric, p_narration text, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_supplier uuid; v_party uuid; v_cc text; v_tag text; v_lines jsonb; v_res jsonb;
        v_amt numeric(18,2) := round(coalesce(p_amount, 0), 2);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if v_amt <= 0 then raise exception 'Enter an amount'; end if;
  if p_cash_bank is null then raise exception 'Choose the cash / bank account the money went from.'; end if;

  select d.party_id, d.cost_center, d.tag_area into v_supplier, v_cc, v_tag
    from trade_documents d
   where d.id = p_source_doc_id and d.company_id = p_company and d.doc_type = 'purchase_order';
  if v_supplier is null then raise exception 'Purchase Order not found, or it has no supplier on it.'; end if;
  if exists (select 1 from trade_documents t
              where t.company_id = p_company and t.doc_type = 'purchase_voucher' and t.source_doc_id = p_source_doc_id) then
    raise exception 'That Purchase Order is already loaded into a Purchase Voucher — pay against its bill instead.';
  end if;

  v_party := ensure_party_account(p_company, v_supplier, 'supplier');
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', p_cash_bank::text, 'debit', 0, 'credit', v_amt, 'description', p_narration),
    jsonb_build_object('account_id', v_party::text, 'debit', v_amt, 'credit', 0, 'description', p_narration,
                        'cost_center', v_cc, 'tag_area', v_tag));

  v_res := gl_submit(p_company, p_date, p_narration, 'gl_payment', p_reference, v_lines,
                      jsonb_build_object('po_id', p_source_doc_id::text, 'po_amount', v_amt::text));

  -- Posted straight away (no rule matched): the advance is settled and its
  -- entry_id is known now, so the link is recorded here. Held for approval:
  -- there is no entry yet — voucher_approve records it once one exists.
  if not coalesce((v_res->>'pending')::boolean, false) then
    insert into po_advances(company_id, source_doc_id, entry_id, supplier_id, amount, created_by)
    values (p_company, p_source_doc_id, (v_res->>'entry_id')::uuid, v_supplier, v_amt, auth.uid());
  end if;
  return v_res;
end $function$;
revoke all on function public.po_payment_save(uuid, date, uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.po_payment_save(uuid, date, uuid, uuid, numeric, text, text) to authenticated;

-- ── the adoption: once the Purchase Voucher raises its bill, sweep whatever
-- was already paid against this PO onto it — the same idea as
-- car_receipt_settle_bills, built on the same open_item_settle primitive, just
-- for a PO's un-targeted advances rather than a car contract's named
-- instalments. Idempotent: adopted_at is only set once, and an advance is
-- never picked up twice even if this is ever called again. ─────────────────
create or replace function public.po_advances_settle(p_source_doc uuid, p_item uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare adv record;
begin
  if p_item is null or p_source_doc is null then return; end if;
  for adv in select id, entry_id, amount from po_advances
              where source_doc_id = p_source_doc and adopted_at is null
              order by created_at loop
    if not exists (select 1 from allocations where settle_entry_id = adv.entry_id and open_item_id = p_item) then
      perform open_item_settle(p_item, adv.entry_id, adv.amount, 'PO advance');
    end if;
    update po_advances set adopted_at = now(), adopted_item_id = p_item where id = adv.id;
  end loop;
end $function$;
revoke all on function public.po_advances_settle(uuid, uuid) from public, anon, authenticated;

-- ── voucher_approve: record the link once the held Payment actually posts ──
create or replace function public.voucher_approve(p_pending uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare pv pending_vouchers%rowtype; v_count int; v jsonb; v_lim numeric(18,2);
        v_fn text; v_doc uuid; v_entry uuid;
begin
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if not acct_can_authorize_pending(p_pending) then
    raise exception 'You are not an approver for this voucher';
  end if;
  if pv.status <> 'pending' then raise exception 'Voucher is already %', pv.status; end if;
  if pv.created_by = auth.uid() and not is_admin() then
    raise exception 'You cannot authorise your own voucher (maker-checker)';
  end if;
  if not is_admin() then
    select acct_authorize_limit into v_lim from profiles where id = auth.uid();
    if v_lim is not null and pv.amount > v_lim then
      raise exception 'Amount % exceeds your authorisation limit of %', pv.amount, v_lim;
    end if;
  end if;

  insert into pending_voucher_approvals(pending_id, actor, action) values (p_pending, auth.uid(), 'approve')
    on conflict (pending_id, actor, action) do nothing;
  select count(*) into v_count from pending_voucher_approvals where pending_id = p_pending and action = 'approve';

  if v_count >= pv.approvals_needed then
    if pv.payload ? 'post_fn' then
      v_fn := pv.payload->>'post_fn';
      if v_fn not in ('trade_doc_post_now', 'payroll_post_now') then
        raise exception 'Unknown posting routine %', v_fn;
      end if;
      v_doc := (pv.payload->>'doc_id')::uuid;
      execute format('select %I($1)', v_fn) into v using v_doc;
      if v_fn = 'trade_doc_post_now' then
        select gl_entry into v_entry from trade_documents where id = v_doc;
      else
        select gl_entry into v_entry from payroll_runs where id = v_doc;
      end if;
    else
      v := gl_post(pv.company_id, pv.entry_date, pv.narration, pv.doc_type, 'approved', pv.reference, pv.lines);
      if pv.payload ? 'lines' then
        perform apply_billwise_allocations(pv.company_id, (v->>'entry_id')::uuid, pv.payload->'lines');
      end if;
      v_entry := (v->>'entry_id')::uuid;
      -- A Payment held for approval because it named a Purchase Order: the
      -- entry exists now, so the advance can finally be recorded against it.
      if pv.payload ? 'po_id' then
        insert into po_advances(company_id, source_doc_id, entry_id, supplier_id, amount, created_by)
        select pv.company_id, (pv.payload->>'po_id')::uuid, v_entry, d.party_id,
               coalesce((pv.payload->>'po_amount')::numeric, pv.amount), pv.created_by
        from trade_documents d where d.id = (pv.payload->>'po_id')::uuid;
      end if;
    end if;

    update pending_vouchers set status = 'authorized', posted_entry_id = v_entry where id = p_pending;
    perform acct_log(pv.company_id, 'authorized', pv.doc_type, v->>'entry_no', jsonb_build_object('pending_id', p_pending));
    perform push_notification('staff', null, 'accounting', 'Voucher authorised & posted',
      pv.doc_type || ' ' || coalesce(v->>'entry_no', '') || ' posted', 'accounting', null, null);
    return jsonb_build_object('posted', true, 'entry_no', v->>'entry_no');
  end if;
  perform acct_log(pv.company_id, 'approval', pv.doc_type, p_pending::text,
    jsonb_build_object('count', v_count, 'needed', pv.approvals_needed));
  return jsonb_build_object('posted', false, 'remaining', pv.approvals_needed - v_count);
end $function$;
revoke all on function public.voucher_approve(uuid) from public, anon;
grant execute on function public.voucher_approve(uuid) to authenticated;

-- ── trade_doc_post_now: settle a Purchase Voucher's bill with whatever was
-- already advanced against the Purchase Order it was loaded from, the moment
-- the bill is raised. Unchanged for every other document type. ────────────
create or replace function public.trade_doc_post_now(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d trade_documents; v_co uuid; ln record; is_stk boolean; prc numeric;
        v_stock numeric(18,2) := 0; v_other numeric(18,2) := 0; v_cogs_val numeric(18,2) := 0;
        v_party uuid; v_inv uuid; v_pur uuid; v_sr uuid; v_cogs uuid; v_ro uuid; v_veh uuid; v_sale uuid;
        lines jsonb := '[]'::jsonb; g jsonb; v_dr numeric(18,2); v_cr numeric(18,2); v_diff numeric(18,2); mv jsonb;
        v_upd_stock boolean; v_wh uuid; v_acct uuid; v_is_car boolean; v_car_cost numeric(18,2) := 0;
        v_fx numeric; v_sell numeric(18,2); v_supcost numeric(18,2); v_sup uuid; v_sup_acct uuid;
        v_label text; v_sale_name text; v_cost_name text; v_sale_rule text; v_cost_rule text; v_cash numeric(18,2);
        v_item uuid;
begin
  -- The company is the document's. This routine is internal (not granted to
  -- any role) and is reached from the gate, from an approval, and from the
  -- modules raising an invoice with no staff session behind them.
  select * into d from trade_documents where id = p_id;
  if not found then raise exception 'Document not found'; end if;
  v_co := d.company_id;
  if d.gl_entry is not null then raise exception 'Already posted'; end if;
  if d.doc_type not in ('purchase_voucher','purchase_return','sales_return','sales_invoice',
                        'air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice') then
    raise exception 'This document type does not post to the GL';
  end if;

  v_upd_stock := d.doc_type = 'sales_invoice'
                 or coalesce((d.meta->>'update_stock')::boolean, true);
  v_is_car := is_car_cost_center(d.cost_center);
  if d.source_car_contract is not null and d.doc_type = 'sales_return' then
    v_upd_stock := false;
  end if;
  -- A service invoice is not goods: a ticket, a visa, a trip or a room is
  -- never issued from a warehouse, whatever item its line points at.
  if d.doc_type in ('air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice') then
    v_upd_stock := false;
  end if;
  v_wh := d.warehouse_id;
  if v_upd_stock and not v_is_car and v_wh is null then
    select id into v_wh from warehouses where company_id = v_co and coalesce(is_active, true) order by created_at limit 1;
  end if;

  for ln in select l.*, pr.is_stock, pr.purchase_rate from trade_document_lines l
            left join acct_products pr on pr.id = l.product_id where l.doc_id = p_id order by l.sort loop
    is_stk := v_upd_stock and not v_is_car and coalesce(ln.is_stock, false) and ln.product_id is not null;
    if is_stk then
      if v_wh is null then raise exception 'No warehouse is set up, so stock cannot be updated. Add a warehouse or untick Update Stocks.'; end if;
      if d.doc_type = 'purchase_voucher' then
        perform stock_move('receipt', ln.product_id, v_wh, ln.quantity, coalesce(nullif(ln.rate,0), ln.amount/nullif(ln.quantity,0)), d.doc_date, d.doc_no, 'Purchase '||d.doc_no, false, null);
        v_stock := v_stock + ln.amount;
      elsif d.doc_type = 'purchase_return' then
        mv := stock_move('issue', ln.product_id, v_wh, ln.quantity, 0, d.doc_date, d.doc_no, 'Purch return '||d.doc_no, false, null);
        v_stock := v_stock + (mv->>'value')::numeric;
      elsif d.doc_type = 'sales_invoice' then
        mv := stock_move('issue', ln.product_id, v_wh, ln.quantity, 0, d.doc_date, d.doc_no, 'Sale '||d.doc_no, false, null);
        v_cogs_val := v_cogs_val + (mv->>'value')::numeric;
      elsif d.doc_type = 'sales_return' then
        prc := coalesce(nullif(ln.purchase_rate,0), 0);
        if prc > 0 then
          perform stock_move('receipt', ln.product_id, v_wh, ln.quantity, prc, d.doc_date, d.doc_no, 'Sales return '||d.doc_no, false, null);
          v_cogs_val := v_cogs_val + round(ln.quantity * prc, 2);
        end if;
      end if;
    elsif not v_is_car then
      v_other := v_other + ln.amount;
    end if;
  end loop;

  v_inv := acct_ensure_named(v_co, 'Inventory', 'asset', '1', 'Current Asset');
  v_ro  := acct_ensure_named(v_co, 'Round Off', 'expense', '5', 'Indirect Expense');
  if v_is_car then
    perform car_ensure_accounts(v_co);
    v_veh := acct(v_co, '1160');
  end if;

  if d.doc_type = 'purchase_voucher' or d.doc_type = 'purchase_return' then
    v_party := ensure_party_account(v_co, d.party_id, 'supplier');
    select id into v_acct from accounts
      where id = nullif(d.meta->>'purchase_account','')::uuid and company_id = v_co and is_postable;
    v_pur := coalesce(v_acct, acct_ensure_named(v_co, 'Purchases', 'expense', '5', 'COGS'));
    if d.doc_type = 'purchase_voucher' then
      if v_is_car then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_veh::text, 'debit', d.total, 'credit', 0, 'description', 'Vehicle purchase '||d.doc_no)); end if;
      if v_stock > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_inv::text, 'debit', v_stock, 'credit', 0, 'description', 'Stock '||d.doc_no)); end if;
      if v_other > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_pur::text, 'debit', v_other, 'credit', 0, 'description', 'Purchase '||d.doc_no)); end if;
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_party::text, 'debit', 0, 'credit', d.total, 'description', coalesce(d.narration, d.doc_no), 'cost_center', d.cost_center, 'tag_area', d.tag_area));
    else
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_party::text, 'debit', d.total, 'credit', 0, 'description', coalesce(d.narration, d.doc_no), 'cost_center', d.cost_center, 'tag_area', d.tag_area));
      if v_is_car then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_veh::text, 'debit', 0, 'credit', d.total, 'description', 'Vehicle return '||d.doc_no)); end if;
      if v_stock > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_inv::text, 'debit', 0, 'credit', v_stock, 'description', 'Stock '||d.doc_no)); end if;
      if v_other > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_pur::text, 'debit', 0, 'credit', v_other, 'description', 'Purchase '||d.doc_no)); end if;
    end if;

  elsif d.doc_type = 'sales_invoice' then
    v_party := ensure_party_account(v_co, d.party_id, 'customer');
    select id into v_acct from accounts
      where id = nullif(d.meta->>'sale_account','')::uuid and company_id = v_co and is_postable;
    v_sale := coalesce(v_acct, acct_ensure_named(v_co, 'Sales', 'income', '4', 'Revenue'));
    lines := lines || jsonb_build_array(
      jsonb_build_object('account_id', v_party::text, 'debit', d.total, 'credit', 0, 'description', coalesce(d.narration, d.doc_no)),
      jsonb_build_object('account_id', v_sale::text, 'debit', 0, 'credit', d.total, 'description', 'Sale '||d.doc_no, 'cost_center', d.cost_center, 'tag_area', d.tag_area));
    if v_cogs_val > 0 then
      v_cogs := acct_ensure_named(v_co, 'Cost of Goods Sold', 'expense', '5', 'COGS');
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_cogs::text, 'debit', v_cogs_val, 'credit', 0, 'description', 'Cost of sale '||d.doc_no, 'cost_center', d.cost_center),
        jsonb_build_object('account_id', v_inv::text, 'debit', 0, 'credit', v_cogs_val, 'description', 'Stock issued '||d.doc_no));
    end if;

  -- ── THE SERVICE INVOICES: air ticket, visa, transport, hotel ────────────
  -- Bought from a supplier and sold to the customer on the one document:
  --     Dr the customer      gross          Cr <Module> Sales     gross
  --     Dr <Module> Cost     supplier       Cr the supplier       supplier
  -- and, when the supplier collected cash from the passenger on our behalf
  -- (a transport vendor does), Dr the supplier / Cr the customer for it.
  elsif d.doc_type in ('air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice') then
    select l, s, c, sr, cr into v_label, v_sale_name, v_cost_name, v_sale_rule, v_cost_rule from (values
      ('air_ticket_invoice', 'Air ticket', 'Air Ticket Sales', 'Air Ticket Cost', null::text,                   null::text),
      ('visa_invoice',       'Visa',       'Visa Sales',       'Visa Cost',       'visa.group_created',         'visa.supplier_cost'),
      ('transport_invoice',  'Transport',  'Transport Sales',  'Transport Cost',  'transport.trip_completed',   'transport.vendor_cost'),
      ('hotel_invoice',      'Hotel',      'Hotel Sales',      'Hotel Cost',      'hotel.vendor_confirmed',     'hotel.supplier_cost')
    ) as t(k, l, s, c, sr, cr) where t.k = d.doc_type;

    v_fx := trade_doc_fx(d.meta);
    v_party := ensure_party_account(v_co, d.party_id, 'customer');
    v_sell := round(coalesce(d.total, 0) * v_fx, 2);
    select round(coalesce(sum(round(coalesce((l.meta->>'supplier_amount')::numeric, 0), 2)), 0) * v_fx, 2)
      into v_supcost from trade_document_lines l where l.doc_id = p_id;
    v_supcost := coalesce(v_supcost, 0);
    v_cash := round(coalesce((d.meta->>'cash_by_supplier')::numeric, 0) * v_fx, 2);

    if v_sell = 0 and v_supcost = 0 then
      raise exception 'This % invoice is for nothing — enter the amount, or the supplier cost, or both.', lower(v_label);
    end if;

    if v_sell <> 0 then
      v_sale := coalesce(case when v_sale_rule is not null then acct_automation_account(v_co, v_sale_rule, 'credit') end,
                         acct_ensure_named(v_co, v_sale_name, 'income', '4', 'Revenue'));
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_party::text, 'debit', v_sell, 'credit', 0,
                           'description', coalesce(d.narration, d.doc_no)),
        jsonb_build_object('account_id', v_sale::text, 'debit', 0, 'credit', v_sell,
                           'description', v_label||' '||d.doc_no, 'cost_center', d.cost_center, 'tag_area', d.tag_area));
    end if;

    if v_supcost <> 0 or v_cash <> 0 then
      -- The supplier: a party (its ledger account is found or raised), or an
      -- account named directly, for the modules that keep suppliers that way.
      v_sup := nullif(d.meta->>'supplier_id','')::uuid;
      if v_sup is not null then
        v_sup_acct := ensure_party_account(v_co, v_sup, 'supplier');
      else
        select id into v_sup_acct from accounts
         where id = nullif(d.meta->>'supplier_account_id','')::uuid and company_id = v_co and is_postable;
      end if;
      if v_sup_acct is null then
        raise exception 'This invoice carries a supplier cost of %, but no supplier is chosen. Pick the supplier — the cost has to be owed to somebody.', v_supcost;
      end if;
    end if;
    if v_supcost <> 0 then
      v_cogs := coalesce(case when v_cost_rule is not null then acct_automation_account(v_co, v_cost_rule, 'debit') end,
                         acct_ensure_named(v_co, v_cost_name, 'expense', '5', 'COGS'));
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_cogs::text, 'debit', v_supcost, 'credit', 0,
                           'description', v_label||' cost '||d.doc_no, 'cost_center', d.cost_center),
        jsonb_build_object('account_id', v_sup_acct::text, 'debit', 0, 'credit', v_supcost,
                           'description', v_label||' cost '||d.doc_no));
    end if;
    if v_cash <> 0 then
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_sup_acct::text, 'debit', v_cash, 'credit', 0,
                           'description', 'Cash collected by supplier '||d.doc_no),
        jsonb_build_object('account_id', v_party::text, 'debit', 0, 'credit', v_cash,
                           'description', 'Cash collected by supplier '||d.doc_no, 'cost_center', d.cost_center));
    end if;

  else -- sales_return
    v_party := ensure_party_account(v_co, d.party_id, 'customer');
    select id into v_acct from accounts
      where id = nullif(d.meta->>'sale_account','')::uuid and company_id = v_co and is_postable;
    v_sr := coalesce(v_acct, acct_ensure_named(v_co, 'Sales Returns', 'income', '4', 'Revenue'));
    lines := lines || jsonb_build_array(
      jsonb_build_object('account_id', v_sr::text, 'debit', d.total, 'credit', 0, 'description', 'Sales return '||d.doc_no, 'cost_center', d.cost_center, 'tag_area', d.tag_area),
      jsonb_build_object('account_id', v_party::text, 'debit', 0, 'credit', d.total, 'description', coalesce(d.narration, d.doc_no)));
    if v_cogs_val > 0 then
      v_cogs := acct_ensure_named(v_co, 'Cost of Goods Sold', 'expense', '5', 'COGS');
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_inv::text, 'debit', v_cogs_val, 'credit', 0, 'description', 'Stock return '||d.doc_no),
        jsonb_build_object('account_id', v_cogs::text, 'debit', 0, 'credit', v_cogs_val, 'description', 'COGS reversal '||d.doc_no));
    end if;
    if d.source_car_contract is not null then
      select coalesce(nullif(v.total_cost, 0), v.purchase_cost, c.purchase_cost, 0)
        into v_car_cost
      from car_contracts c join car_vehicles v on v.id = c.vehicle_id
      where c.id = d.source_car_contract and c.company_id = v_co;
      if coalesce(v_car_cost, 0) > 0 then
        v_cogs := acct_ensure_named(v_co, 'Cost of Goods Sold', 'expense', '5', 'COGS');
        perform car_ensure_accounts(v_co);
        lines := lines || jsonb_build_array(
          jsonb_build_object('account_id', acct(v_co, '1160')::text, 'debit', v_car_cost, 'credit', 0,
                             'description', 'Vehicle back in stock '||d.doc_no),
          jsonb_build_object('account_id', acct(v_co, '5100')::text, 'debit', 0, 'credit', v_car_cost,
                             'description', 'Cost of sale reversed '||d.doc_no, 'cost_center', d.cost_center));
      end if;
    end if;
  end if;

  select coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0)
    into v_dr, v_cr from jsonb_array_elements(lines) x;
  v_diff := round(v_dr - v_cr, 2);
  if v_diff <> 0 then
    if v_diff > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_ro::text, 'debit', 0, 'credit', v_diff, 'description', 'Round off'));
    else lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_ro::text, 'debit', -v_diff, 'credit', 0, 'description', 'Round off')); end if;
  end if;

  g := gl_post_internal(v_co, d.doc_date, coalesce(d.narration, d.doc_no), 'gl_trade_'||d.doc_type, d.doc_type, d.doc_no, lines);
  update trade_documents set gl_entry = (g->>'entry_id')::uuid, posted_at = now(), status = 'posted',
    warehouse_id = coalesce(warehouse_id, case when v_upd_stock then v_wh end)
  where id = p_id;

  -- THE BILL. What the customer now owes, or what we now owe the supplier,
  -- as an open item the Receipt / Payment voucher adjusts against. Without it
  -- the bill-wise popup had nothing to offer (migration 385).
  if d.doc_type = 'sales_invoice' then
    perform open_item_raise(v_co, (g->>'entry_id')::uuid, v_party, 'D', d.doc_type, d.doc_no, d.doc_date, d.due_date, d.total);
  elsif d.doc_type in ('air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice') then
    perform open_item_raise(v_co, (g->>'entry_id')::uuid, v_party, 'D', d.doc_type, d.doc_no, d.doc_date, d.due_date, v_sell);
    if v_supcost <> 0 then
      perform open_item_raise(v_co, (g->>'entry_id')::uuid, v_sup_acct, 'C', d.doc_type, d.doc_no, d.doc_date, d.due_date, v_supcost);
    end if;
  elsif d.doc_type = 'purchase_voucher' then
    -- What was already advanced against the Purchase Order this was loaded
    -- from settles the bill the moment it exists — never due twice.
    v_item := open_item_raise(v_co, (g->>'entry_id')::uuid, v_party, 'C', d.doc_type, d.doc_no, d.doc_date, d.due_date, d.total);
    if d.source_doc_id is not null then
      perform po_advances_settle(d.source_doc_id, v_item);
    end if;
  elsif d.doc_type = 'purchase_return' then
    perform open_item_raise(v_co, (g->>'entry_id')::uuid, v_party, 'D', d.doc_type, d.doc_no, d.doc_date, null, d.total);
  elsif d.doc_type = 'sales_return' then
    perform open_item_raise(v_co, (g->>'entry_id')::uuid, v_party, 'C', d.doc_type, d.doc_no, d.doc_date, null, d.total);
  end if;
  return jsonb_build_object('posted', true, 'entry_no', g->>'entry_no');
end $function$;
revoke all on function public.trade_doc_post_now(uuid) from public, anon, authenticated;

-- ── self-check: shapes and grants only (a full rehearsal against real data,
-- rolled back, was run separately against production before this was
-- considered done — see the session's own notes). ──────────────────────────
do $chk$
declare v_auth boolean; v_anon boolean;
begin
  select has_function_privilege('authenticated', 'public.po_payment_save(uuid,date,uuid,uuid,numeric,text,text)', 'execute'),
         has_function_privilege('anon', 'public.po_payment_save(uuid,date,uuid,uuid,numeric,text,text)', 'execute')
    into v_auth, v_anon;
  if not v_auth or v_anon then
    raise exception 'po_payment_save grants wrong: authenticated=%, anon=%', v_auth, v_anon;
  end if;

  select has_function_privilege('authenticated', 'public.po_pending_advance()', 'execute'),
         has_function_privilege('anon', 'public.po_pending_advance()', 'execute')
    into v_auth, v_anon;
  if not v_auth or v_anon then
    raise exception 'po_pending_advance grants wrong: authenticated=%, anon=%', v_auth, v_anon;
  end if;

  select has_function_privilege('authenticated', 'public.po_advances_settle(uuid,uuid)', 'execute'),
         has_function_privilege('anon', 'public.po_advances_settle(uuid,uuid)', 'execute')
    into v_auth, v_anon;
  if v_auth or v_anon then
    raise exception 'po_advances_settle must be internal only: authenticated=%, anon=%', v_auth, v_anon;
  end if;

  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='po_advances') then
    raise exception 'po_advances table missing';
  end if;
end $chk$;
