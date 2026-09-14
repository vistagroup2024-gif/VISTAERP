-- ============================================================
-- 377 — The module invoices are vouchers, and the monthly charge is one
--
-- VISA, TRANSPORT AND HOTEL INVOICES. Each module posted its own invoice its
-- own way — the visa one into a table of its own with a two-field editor, the
-- hotel one as two party_invoice entries, the transport one as a bare
-- gl_post — and the Sales Invoice tabs that showed them were three lists with
-- a Post button. None was a voucher: nothing to open, nothing to type, and a
-- customer to be invoiced by hand for something the module had not raised
-- had no screen at all.
--
-- They are trade documents now, shaped exactly like the Air Ticket Invoice
-- (migration 358): a customer, a supplier, the gross on the line and the
-- supplier's cost beside it, four legs and no stock. The module RAISES one
-- (trade_doc_raise, an internal insert path — the modules fire from
-- triggers and from the driver portal, where there is no staff session for
-- trade_doc_save to check), and from then on it is a voucher like any other:
-- opened by number, edited and re-posted, deleted, printed, or typed from
-- scratch on the same screen. One document per source, enforced by a unique
-- index on the source id the module writes into the meta.
--
-- The posting branch is the air ticket's, generalised: the revenue and cost
-- accounts are named per document type, the account overrides on the
-- automation rules still win, and the supplier may be a PARTY (hotel vendor,
-- consolidator) or an ACCOUNT (a visa company's supplier ledger, a transport
-- vendor's) — the modules keep suppliers both ways. trade_doc_post_now reads
-- the company off the document rather than off the session for the same
-- reason the raise path exists; it is internal and was never callable by a
-- user, so nothing is opened by that.
--
-- The three automation rules that raise them are switched ON: an invoice
-- that is created automatically is what was asked for, and every one of them
-- was off.
--
-- MONTHLY CHARGES. One voucher a month (migration 350) — but the screen was a
-- flat register and a Generate button, reached from two places. It is a
-- voucher now: a month is opened like a document, its lines are the cars
-- charged that month, an amount can be corrected or a car added or taken
-- off, and Save rebuilds the month's journal entry from what is on it.
-- car_charges_month_load draws it; car_charges_month_save is the one door.
-- ============================================================
begin;

-- ── one document per source ────────────────────────────────────────────────
create unique index if not exists trade_documents_module_source_uidx
  on public.trade_documents ((meta->>'source_id'))
  where doc_type in ('visa_invoice', 'transport_invoice', 'hotel_invoice') and (meta ? 'source_id');

-- ── the gate: three more types post ────────────────────────────────────────
create or replace function public.trade_doc_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d trade_documents; v_co uuid := auth_company_id(); v_needed int; v_id uuid; v_rule uuid;
        v_amt numeric(18,2);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.gl_entry is not null then raise exception 'Already posted'; end if;
  if d.doc_type not in ('purchase_voucher','purchase_return','sales_return','sales_invoice',
                        'air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice') then
    raise exception 'This document type does not post to the GL';
  end if;
  if d.status = 'awaiting_approval' then
    raise exception 'This voucher is already awaiting authorisation.';
  end if;
  v_amt := round(coalesce(d.total, 0) * trade_doc_fx(d.meta), 2);
  v_rule   := acct_rule_for(v_co, d.doc_type, v_amt, d.cost_center, auth.uid());
  v_needed := acct_approvals_needed(v_co, d.doc_type, v_amt, d.cost_center, auth.uid());
  if v_needed >= 1 then
    v_id := acct_hold_document(v_co, d.doc_type, d.doc_date, coalesce(d.narration, d.doc_no),
                               d.doc_no, v_amt, v_needed, 'trade_doc_post_now', p_id, v_rule);
    update trade_documents set status = 'awaiting_approval' where id = p_id;
    return jsonb_build_object('pending', true, 'pending_id', v_id, 'amount', v_amt);
  end if;
  return trade_doc_post_now(p_id) || jsonb_build_object('pending', false);
end $function$;

-- ── a ledger poster with no session behind it ──────────────────────────────
-- gl_post refuses a caller that is not signed-in staff, which is right for
-- everything a user reaches. A trade document is posted by trade_doc_post_now,
-- which nobody can call directly: it runs for the gate, for an approval, and
-- for a module raising an invoice from a trigger — and a trip completed from
-- the driver portal has no staff session at all. The rehearsal below is what
-- found that: the old transport poster had the same call in it and would have
-- refused every portal completion. This is gl_post without the session check,
-- granted to no role.
create or replace function public.gl_post_internal(p_company uuid, p_date date, p_memo text, p_doc_type text, p_source text, p_reference text, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_entry uuid; v_no text; ln jsonb; d numeric(18,2); c numeric(18,2); v_closed date;
begin
  if p_company is null then raise exception 'gl_post_internal: no company'; end if;
  select closed_through into v_closed from acct_settings where company_id = p_company;
  if v_closed is not null and p_date <= v_closed then
    raise exception 'Period is closed through % — cannot post on %', v_closed, p_date;
  end if;
  perform gl_validate(p_company, p_lines);
  v_no := next_doc_number(p_company, p_doc_type);
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference, created_by)
  values (p_company, v_no, p_date, p_memo, 'posted', p_source, p_reference, auth.uid())
  returning id into v_entry;
  for ln in select * from jsonb_array_elements(p_lines) loop
    d := round(coalesce((ln->>'debit')::numeric, 0), 2);
    c := round(coalesce((ln->>'credit')::numeric, 0), 2);
    if d = 0 and c = 0 then continue; end if;
    insert into journal_lines(entry_id, account_id, description, debit, credit, cost_center, tag_area)
    values (v_entry, (ln->>'account_id')::uuid, ln->>'description', d, c, ln->>'cost_center', ln->>'tag_area');
  end loop;
  return jsonb_build_object('entry_id', v_entry, 'entry_no', v_no);
end $function$;
revoke all on function public.gl_post_internal(uuid, date, text, text, text, text, jsonb) from public, anon, authenticated;

-- ── the posting ────────────────────────────────────────────────────────────
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
  return jsonb_build_object('posted', true, 'entry_no', g->>'entry_no');
end $function$;
revoke all on function public.trade_doc_post_now(uuid) from public, anon, authenticated;

-- ── saving posts it ────────────────────────────────────────────────────────
create or replace function public.trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0;
  v_sub numeric(18,2) := 0; v_round numeric(18,2); v_disc numeric(18,2); v_total numeric(18,2);
  v_src uuid; v_car uuid; v_status text; v_gl uuid; v_posted jsonb; v_meta jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then perform staff_require_doc(p_type, 'create');
  else perform staff_require_trade_right(p_id, 'edit'); end if;
  perform staff_require_scope_products(p_lines);

  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
  v_disc  := round(coalesce((p_header->'meta'->>'discount')::numeric, 0), 2);
  v_src := nullif(p_header->>'source_doc_id','')::uuid;
  v_car := nullif(p_header->>'source_car_contract','')::uuid;
  v_meta := coalesce(p_header->'meta','{}'::jsonb);

  select coalesce(sum(round(coalesce((x->>'amount')::numeric,0),2)), 0) into v_sub
  from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x;
  v_total := v_sub - v_disc + v_round;

  if p_type = 'sales_invoice' and is_car_cost_center(p_header->>'cost_center') then
    raise exception 'A car sale is invoiced in Car Sales, not with a Sales Invoice.';
  end if;

  if v_id is not null then
    select status, gl_entry into v_status, v_gl
    from trade_documents where id = v_id and company_id = v_co;
    if v_status = 'awaiting_approval' then
      raise exception 'This voucher is awaiting authorisation and cannot be changed.';
    end if;
    if v_gl is not null then
      perform staff_require_doc_strict(p_type, 'edit_posted');
      perform trade_doc_unpost(v_id, 'edited');
    end if;
    -- A module invoice keeps the link to what raised it, whatever the screen
    -- sent back: losing it would let the module raise a second one.
    if p_type in ('visa_invoice','transport_invoice','hotel_invoice') then
      select v_meta || jsonb_strip_nulls(jsonb_build_object('source_kind', t.meta->>'source_kind', 'source_id', t.meta->>'source_id'))
        into v_meta from trade_documents t where t.id = v_id;
    end if;
  end if;

  if v_src is not null and exists (
    select 1 from trade_documents t
    where t.company_id = v_co and t.doc_type = p_type and t.source_doc_id = v_src
      and (v_id is null or t.id <> v_id)) then
    raise exception 'That document has already been loaded into another %.', p_type;
  end if;
  if v_car is not null and exists (
    select 1 from trade_documents t
    where t.company_id = v_co and t.doc_type = p_type and t.source_car_contract = v_car
      and (v_id is null or t.id <> v_id)) then
    raise exception 'That Car Invoice has already been loaded into another %.', p_type;
  end if;

  if v_id is null then
    insert into doc_sequences(company_id, doc_type, prefix)
    values (v_co, 'trade_'||p_type, coalesce(nullif(p_prefix,''), upper(left(p_type,3))||'-'))
    on conflict (company_id, doc_type) do nothing;
    v_no := next_doc_number(v_co, 'trade_'||p_type);
    insert into trade_documents(company_id, doc_type, doc_no, doc_date, party_id, cost_center, tag_area,
      reference, narration, terms, mode_of_payment, due_date, delivery_date, currency, round_off,
      subtotal, total, status, meta, source_doc_id, source_car_contract, created_by)
    values (v_co, p_type, v_no, coalesce(nullif(p_header->>'doc_date','')::date, current_date),
      nullif(p_header->>'party_id','')::uuid, nullif(p_header->>'cost_center',''), nullif(p_header->>'tag_area',''),
      nullif(p_header->>'reference',''), nullif(p_header->>'narration',''), nullif(p_header->>'terms',''),
      nullif(p_header->>'mode_of_payment',''), nullif(p_header->>'due_date','')::date,
      nullif(p_header->>'delivery_date','')::date, coalesce(nullif(p_header->>'currency',''),'SAR'),
      v_round, v_sub, v_total, coalesce(nullif(p_header->>'status',''),'open'),
      v_meta, v_src, v_car, auth.uid())
    returning id, doc_no into v_id, v_no;
  else
    update trade_documents set
      doc_date = coalesce(nullif(p_header->>'doc_date','')::date, current_date),
      party_id = nullif(p_header->>'party_id','')::uuid,
      cost_center = nullif(p_header->>'cost_center',''), tag_area = nullif(p_header->>'tag_area',''),
      reference = nullif(p_header->>'reference',''), narration = nullif(p_header->>'narration',''),
      terms = nullif(p_header->>'terms',''), mode_of_payment = nullif(p_header->>'mode_of_payment',''),
      due_date = nullif(p_header->>'due_date','')::date,
      delivery_date = nullif(p_header->>'delivery_date','')::date,
      currency = coalesce(nullif(p_header->>'currency',''),'SAR'),
      round_off = v_round, subtotal = v_sub, total = v_total,
      meta = v_meta,
      source_doc_id = coalesce(v_src, source_doc_id),
      source_car_contract = coalesce(v_car, source_car_contract),
      updated_at = now()
    where id = v_id and company_id = v_co;
    if not found then raise exception 'Document not found'; end if;
    select doc_no into v_no from trade_documents where id = v_id;
    delete from trade_document_lines where doc_id = v_id;
  end if;

  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    i := i + 1;
    if coalesce(nullif(ln->>'item_name',''), nullif(ln->>'product_id','')) is null
       and round(coalesce((ln->>'amount')::numeric,0),2) = 0 then continue; end if;
    insert into trade_document_lines(doc_id, sort, product_id, item_name, units, quantity, rate, amount, link1, meta)
    values (v_id, i, nullif(ln->>'product_id','')::uuid, nullif(ln->>'item_name',''), nullif(ln->>'units',''),
      round(coalesce((ln->>'quantity')::numeric,0),3), round(coalesce((ln->>'rate')::numeric,0),2),
      round(coalesce((ln->>'amount')::numeric,0),2), nullif(ln->>'link1',''), coalesce(ln->'meta','{}'::jsonb));
  end loop;

  if p_header ? 'warehouse_id' and nullif(p_header->>'warehouse_id','') is not null then
    update trade_documents set warehouse_id = (p_header->>'warehouse_id')::uuid where id = v_id;
  end if;

  if p_type in ('purchase_voucher','purchase_return','sales_return','sales_invoice',
                'air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice') then
    v_posted := trade_doc_post(v_id);
  end if;
  return coalesce(v_posted, '{}'::jsonb) || jsonb_build_object('id', v_id, 'doc_no', v_no);
end $function$;

-- ── the modules' door: raise an invoice with no session behind it ──────────
create or replace function public.trade_doc_raise(p_company uuid, p_type text, p_prefix text, p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_no text; ln jsonb; i int := 0; v_sub numeric(18,2) := 0; v_round numeric(18,2); v_disc numeric(18,2);
  v_total numeric(18,2); v_src text; v_needed int; v_rule uuid; v_pend uuid; v_date date; v_narr text;
begin
  if p_type not in ('visa_invoice','transport_invoice','hotel_invoice') then
    raise exception 'trade_doc_raise: % is not a module invoice', p_type;
  end if;
  if p_company is null then raise exception 'trade_doc_raise: no company'; end if;
  v_src := nullif(p_header->'meta'->>'source_id','');
  if v_src is not null then
    select id, doc_no into v_id, v_no from trade_documents where doc_type = p_type and meta->>'source_id' = v_src;
    if v_id is not null then return jsonb_build_object('id', v_id, 'doc_no', v_no, 'existing', true); end if;
  end if;

  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
  v_disc  := round(coalesce((p_header->'meta'->>'discount')::numeric, 0), 2);
  select coalesce(sum(round(coalesce((x->>'amount')::numeric,0),2)), 0) into v_sub
  from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x;
  v_total := v_sub - v_disc + v_round;
  v_date := coalesce(nullif(p_header->>'doc_date','')::date, current_date);
  v_narr := nullif(p_header->>'narration','');

  insert into doc_sequences(company_id, doc_type, prefix)
  values (p_company, 'trade_'||p_type, coalesce(nullif(p_prefix,''), upper(left(p_type,3))||'-'))
  on conflict (company_id, doc_type) do nothing;
  v_no := next_doc_number(p_company, 'trade_'||p_type);
  insert into trade_documents(company_id, doc_type, doc_no, doc_date, party_id, cost_center, tag_area,
    reference, narration, terms, mode_of_payment, due_date, currency, round_off,
    subtotal, total, status, meta, created_by)
  values (p_company, p_type, v_no, v_date,
    nullif(p_header->>'party_id','')::uuid, nullif(p_header->>'cost_center',''), nullif(p_header->>'tag_area',''),
    nullif(p_header->>'reference',''), v_narr, nullif(p_header->>'terms',''),
    nullif(p_header->>'mode_of_payment',''), nullif(p_header->>'due_date','')::date,
    coalesce(nullif(p_header->>'currency',''),'SAR'), v_round, v_sub, v_total, 'open',
    coalesce(p_header->'meta','{}'::jsonb), auth.uid())
  returning id into v_id;

  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    i := i + 1;
    if coalesce(nullif(ln->>'item_name',''), nullif(ln->>'product_id','')) is null
       and round(coalesce((ln->>'amount')::numeric,0),2) = 0 then continue; end if;
    insert into trade_document_lines(doc_id, sort, product_id, item_name, units, quantity, rate, amount, link1, meta)
    values (v_id, i, nullif(ln->>'product_id','')::uuid, nullif(ln->>'item_name',''), nullif(ln->>'units',''),
      round(coalesce((ln->>'quantity')::numeric,0),3), round(coalesce((ln->>'rate')::numeric,0),2),
      round(coalesce((ln->>'amount')::numeric,0),2), nullif(ln->>'link1',''), coalesce(ln->'meta','{}'::jsonb));
  end loop;

  -- The same gate a typed voucher goes through: a rule holds it for its
  -- approvers, otherwise it posts now.
  v_rule   := acct_rule_for(p_company, p_type, v_total, p_header->>'cost_center', auth.uid());
  v_needed := acct_approvals_needed(p_company, p_type, v_total, p_header->>'cost_center', auth.uid());
  if v_needed >= 1 then
    v_pend := acct_hold_document(p_company, p_type, v_date, coalesce(v_narr, v_no), v_no, v_total, v_needed,
                                 'trade_doc_post_now', v_id, v_rule);
    update trade_documents set status = 'awaiting_approval' where id = v_id;
    return jsonb_build_object('id', v_id, 'doc_no', v_no, 'pending', true, 'pending_id', v_pend);
  end if;
  return trade_doc_post_now(v_id) || jsonb_build_object('id', v_id, 'doc_no', v_no, 'pending', false);
end $function$;
revoke all on function public.trade_doc_raise(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;

-- ── the modules raise theirs ───────────────────────────────────────────────
create or replace function public.visa_invoice_generate(p_group uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g umrah_groups; v_id uuid; v_nights int; v_prod uuid; v_pname text; v_sup uuid; v_sup_party uuid;
        v_sell numeric(18,2); v_pur numeric(18,2); v_cc text; r jsonb;
begin
  select * into g from umrah_groups where id = p_group;
  if not found then return null; end if;
  select id into v_id from trade_documents where doc_type = 'visa_invoice' and meta->>'source_id' = p_group::text;
  if v_id is not null then return v_id; end if;
  if coalesce(g.pax,0) <= 0 then return null; end if;

  v_nights := coalesce(g.total_nights,
    case when g.covered_from is not null and g.covered_to is not null then (g.covered_to - g.covered_from) else 0 end);
  v_prod := visa_pick_product(g.company_id, g.visa_type, v_nights);
  if v_prod is null then return null; end if;
  select name into v_pname from acct_products where id = v_prod;
  select supplier_account_id, supplier_party_id into v_sup, v_sup_party from group_companies where id = g.group_company_id;
  v_sell := visa_sell_rate(g.company_id, v_prod, g.agent_id, v_nights);
  v_pur  := visa_purchase_rate(g.company_id, v_prod, v_sup);
  v_cc := coalesce((select cost_center from acct_automation_rules
                     where company_id = g.company_id and rule_key = 'visa.group_created' and cost_center is not null), 'UMRAH VISA');
  if g.agent_id is null then return null; end if;

  r := trade_doc_raise(g.company_id, 'visa_invoice', 'VI-',
    jsonb_build_object(
      'doc_date', coalesce(g.group_date, current_date), 'party_id', g.agent_id, 'cost_center', v_cc,
      'reference', g.group_no,
      'narration', 'Visa ' || coalesce(g.group_no, '') || ' — ' || coalesce(g.group_name, ''),
      'meta', jsonb_strip_nulls(jsonb_build_object(
        'source_kind', 'umrah_group', 'source_id', p_group,
        'supplier_id', v_sup_party, 'supplier_account_id', v_sup,
        'haji_name', g.group_name, 'group_no', g.group_no))),
    jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'item_name', v_pname, 'units', 'PAX', 'quantity', g.pax,
      'rate', v_sell, 'amount', round(v_sell * g.pax, 2),
      'meta', jsonb_strip_nulls(jsonb_build_object(
        'supplier_rate', v_pur, 'supplier_amount', round(v_pur * g.pax, 2),
        'visa_type', g.visa_type, 'nights', v_nights)))));
  return (r->>'id')::uuid;
end $function$;

create or replace function public.hotel_purchase_post_gl(p_row uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare hp hotel_purchase_bookings; b hotel_bookings; v_co uuid; v_id uuid; v_cc text; r jsonb; v_narr text;
begin
  select * into hp from hotel_purchase_bookings where id = p_row;
  if not found then return jsonb_build_object('posted', false, 'reason', 'row not found'); end if;
  v_co := hp.company_id;
  select id into v_id from trade_documents where doc_type = 'hotel_invoice' and meta->>'source_id' = p_row::text;
  if v_id is not null then return jsonb_build_object('posted', false, 'reason', 'already invoiced', 'id', v_id); end if;
  if coalesce(hp.vendor_status::text,'') not in ('vendor_confirmed','hcn_pending','hcn_received')
     and not acct_automation_status_ok(v_co, 'hotel_purchase_bookings', 'vendor_status', hp.vendor_status::text) then
    return jsonb_build_object('posted', false, 'reason', 'booking status is not one that posts');
  end if;
  select * into b from hotel_bookings where id = hp.booking_id;
  if not found or b.agent_id is null then return jsonb_build_object('posted', false, 'reason', 'no booking/agent'); end if;
  if round(coalesce(hp.sale_total, 0), 2) = 0 and round(coalesce(hp.purchase_total, 0), 2) = 0 then
    return jsonb_build_object('posted', false, 'reason', 'nothing to post');
  end if;
  v_cc := coalesce((select cost_center from acct_automation_rules
                     where company_id = v_co and rule_key = 'hotel.vendor_confirmed' and cost_center is not null), 'HOTEL');
  v_narr := 'Hotel ' || coalesce(b.booking_no, '') || ' — ' || coalesce(hp.hotel_name, '');

  r := trade_doc_raise(v_co, 'hotel_invoice', 'HI-',
    jsonb_build_object(
      'doc_date', coalesce(hp.check_in, current_date), 'party_id', b.agent_id, 'cost_center', v_cc,
      'reference', b.booking_no, 'narration', v_narr,
      'meta', jsonb_strip_nulls(jsonb_build_object(
        'source_kind', 'hotel_purchase_booking', 'source_id', p_row,
        'supplier_id', hp.supplier_id, 'haji_name', b.guest_name, 'booking_no', b.booking_no))),
    jsonb_build_array(jsonb_build_object(
      'item_name', coalesce(hp.hotel_name, 'Hotel'), 'units', 'STAY', 'quantity', 1,
      'rate', round(coalesce(hp.sale_total, 0), 2), 'amount', round(coalesce(hp.sale_total, 0), 2),
      'meta', jsonb_strip_nulls(jsonb_build_object(
        'supplier_rate', round(coalesce(hp.purchase_total, 0), 2), 'supplier_amount', round(coalesce(hp.purchase_total, 0), 2),
        'hotel', hp.hotel_name, 'city', hp.city, 'check_in', hp.check_in, 'check_out', hp.check_out,
        'nights', hp.nights, 'rooms', hp.rooms, 'room_type', hp.room_type)))));
  update hotel_purchase_bookings set gl_posted_at = now(), gl_sales_entry = r->>'doc_no', gl_purchase_entry = null where id = p_row;
  return jsonb_build_object('posted', true, 'id', r->>'id', 'doc_no', r->>'doc_no', 'pending', coalesce((r->>'pending')::boolean, false));
end $function$;

create or replace function public.transport_trip_post_gl(p_trip uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t transport_trips; b transport_bookings; v_co uuid; v_id uuid; v_cc text; v_outsourced boolean;
        v_vendor_acct uuid; v_vendor text; v_sell numeric(18,2); v_vc numeric(18,2); r jsonb; v_ref text;
begin
  select * into t from transport_trips where id = p_trip;
  if not found then return jsonb_build_object('posted', false, 'reason', 'trip not found'); end if;
  v_co := t.company_id;
  select id into v_id from trade_documents where doc_type = 'transport_invoice' and meta->>'source_id' = p_trip::text;
  if v_id is not null then
    update transport_trips set gl_entry = (select gl_entry from trade_documents where id = v_id) where id = p_trip;
    return jsonb_build_object('posted', false, 'reason', 'already invoiced', 'id', v_id);
  end if;
  if coalesce(t.status,'') <> 'completed'
     and not acct_automation_status_ok(v_co, 'transport_trips', 'status', t.status) then
    return jsonb_build_object('posted', false, 'reason', 'trip status is not one that posts');
  end if;
  if coalesce(t.cancelled_with_booking,false) then return jsonb_build_object('posted', false, 'reason', 'cancelled'); end if;
  select * into b from transport_bookings where id = t.booking_id;
  if not found or b.agent_id is null then return jsonb_build_object('posted', false, 'reason', 'no booking/agent'); end if;

  v_outsourced := coalesce(t.is_outsourced, false) or t.vendor_id is not null;
  v_sell := round(coalesce(t.sell_rate, 0), 2);
  v_vc := case when v_outsourced then round(coalesce(t.vendor_cost, 0), 2) else 0 end;
  if v_sell = 0 and v_vc = 0 then return jsonb_build_object('posted', false, 'reason', 'nothing to post'); end if;
  v_cc := coalesce((select cost_center from acct_automation_rules
                     where company_id = v_co and rule_key = 'transport.trip_completed' and cost_center is not null),
                   case when v_outsourced then 'OUTSOURCE TRANSPORT' else 'VISTA TRANSPORT' end);
  if v_outsourced and t.vendor_id is not null then
    v_vendor_acct := ensure_transport_vendor_account(v_co, t.vendor_id);
    select name into v_vendor from transport_vendors where id = t.vendor_id;
  end if;
  v_ref := coalesce(b.booking_no, '') || '/' || coalesce(t.seq, 0);

  r := trade_doc_raise(v_co, 'transport_invoice', 'TI-',
    jsonb_build_object(
      'doc_date', coalesce(t.trip_date, current_date), 'party_id', b.agent_id, 'cost_center', v_cc,
      'reference', v_ref,
      'narration', 'Transport ' || v_ref || ' — ' || coalesce(t.route_label, ''),
      'meta', jsonb_strip_nulls(jsonb_build_object(
        'source_kind', 'transport_trip', 'source_id', p_trip,
        'supplier_account_id', v_vendor_acct,
        'cash_by_supplier', case when v_outsourced and coalesce(t.cash_received, 0) > 0 then round(t.cash_received, 2) end,
        'haji_name', b.passenger_name, 'booking_no', b.booking_no, 'vendor', v_vendor))),
    jsonb_build_array(jsonb_build_object(
      'item_name', coalesce(t.route_label, 'Transport'), 'units', 'TRIP', 'quantity', 1,
      'rate', v_sell, 'amount', v_sell,
      'meta', jsonb_strip_nulls(jsonb_build_object(
        'supplier_rate', nullif(v_vc, 0), 'supplier_amount', nullif(v_vc, 0),
        'route', t.route_label, 'trip_date', t.trip_date,
        'vehicle', (select name from transport_vehicles where id = t.vehicle_id),
        'driver', coalesce((select name from transport_drivers where id = t.driver_id), t.outsource_driver_name),
        'pax', b.pax)))));
  update transport_trips set gl_entry = (select gl_entry from trade_documents where id = (r->>'id')::uuid), gl_posted_at = now()
   where id = p_trip;
  return jsonb_build_object('posted', true, 'id', r->>'id', 'doc_no', r->>'doc_no', 'pending', coalesce((r->>'pending')::boolean, false));
end $function$;
-- The three are reached through the automation dispatcher and, until now, the
-- Post buttons of the three lists. The lists are gone with this migration, so
-- the routines are internal.
revoke all on function public.visa_invoice_generate(uuid) from public, anon, authenticated;
revoke all on function public.hotel_purchase_post_gl(uuid) from public, anon, authenticated;
revoke all on function public.transport_trip_post_gl(uuid) from public, anon, authenticated;

-- ── the module row follows its voucher ─────────────────────────────────────
-- Unposting, re-posting or deleting the voucher is what the trip and the
-- hotel booking read their "invoiced" flag from.
create or replace function public.trade_doc_module_source_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_src uuid; v_type text; v_kind text;
begin
  if tg_op = 'DELETE' then
    v_type := old.doc_type; v_kind := old.meta->>'source_kind'; v_src := nullif(old.meta->>'source_id','')::uuid;
  else
    v_type := new.doc_type; v_kind := new.meta->>'source_kind'; v_src := nullif(new.meta->>'source_id','')::uuid;
  end if;
  if v_src is null then return coalesce(new, old); end if;
  if v_type = 'transport_invoice' and v_kind = 'transport_trip' then
    if tg_op = 'DELETE' then
      update transport_trips set gl_entry = null, gl_posted_at = null where id = v_src;
    elsif new.gl_entry is distinct from old.gl_entry then
      update transport_trips set gl_entry = new.gl_entry,
             gl_posted_at = case when new.gl_entry is null then null else coalesce(gl_posted_at, now()) end
       where id = v_src;
    end if;
  elsif v_type = 'hotel_invoice' and v_kind = 'hotel_purchase_booking' then
    if tg_op = 'DELETE' then
      update hotel_purchase_bookings set gl_posted_at = null, gl_sales_entry = null, gl_purchase_entry = null where id = v_src;
    elsif new.gl_entry is distinct from old.gl_entry then
      update hotel_purchase_bookings
         set gl_posted_at = case when new.gl_entry is null then null else coalesce(gl_posted_at, now()) end,
             gl_sales_entry = case when new.gl_entry is null then null else new.doc_no end
       where id = v_src;
    end if;
  end if;
  return coalesce(new, old);
end $function$;
drop trigger if exists trg_trade_doc_module_source_sync on public.trade_documents;
create trigger trg_trade_doc_module_source_sync
  after update of gl_entry or delete on public.trade_documents
  for each row execute function public.trade_doc_module_source_sync();

-- ── the invoices are raised automatically ──────────────────────────────────
update acct_automation_rules
   set enabled = true, updated_at = now()
 where rule_key in ('visa.group_created', 'transport.trip_completed', 'hotel.vendor_confirmed')
   and kind = 'trigger';

-- ── MONTHLY CHARGES: the month as a voucher ────────────────────────────────
create or replace function public.car_charges_month_load(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); m date := date_trunc('month', p_month)::date; v_key text; e record;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not staff_has_perm('carsales.charges') then raise exception 'No access to Monthly Charges'; end if;
  v_key := v_co::text || '-' || to_char(m, 'YYYY-MM');
  select id, entry_no, entry_date into e from journal_entries
   where company_id = v_co and source = 'car_scharge_month' and reference = v_key;
  return jsonb_build_object(
    'month', m, 'entry_id', e.id, 'entry_no', e.entry_no, 'entry_date', e.entry_date,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'vehicle_id', s.vehicle_id, 'vehicle', v.vehicle_no,
                'car', nullif(concat_ws(' ', v.make, v.model, v.model_year), ''), 'plate', v.plate_no,
                'customer_id', s.customer_id, 'customer', p.name,
                'amount', s.amount, 'paid', coalesce(s.paid_amount, 0), 'notes', s.notes, 'due_date', s.due_date,
                'delivered', car_contract_delivered_on(s.contract_id),
                'rule_amount', car_charge_for_month(m, car_contract_delivered_on(s.contract_id), coalesce(v.monthly_charge, 1000)))
                order by v.vehicle_no), '[]'::jsonb)
              from car_service_charges s
              join car_vehicles v on v.id = s.vehicle_id
              left join parties p on p.id = s.customer_id
             where s.company_id = v_co and s.charge_month = m),
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object(
                'vehicle_id', v.id, 'vehicle', v.vehicle_no,
                'car', nullif(concat_ws(' ', v.make, v.model, v.model_year), ''), 'plate', v.plate_no,
                'customer', p.name, 'delivered', car_contract_delivered_on(v.contract_id),
                'rule_amount', car_charge_for_month(m, car_contract_delivered_on(v.contract_id), coalesce(v.monthly_charge, 1000)),
                'full', coalesce(v.monthly_charge, 1000))
                order by v.vehicle_no), '[]'::jsonb)
              from car_vehicles v
              left join parties p on p.id = v.current_customer_id
             where v.company_id = v_co and v.ownership = 'vista' and v.contract_id is not null
               and not exists (select 1 from car_service_charges s where s.vehicle_id = v.id and s.charge_month = m)),
    'months', (select coalesce(jsonb_agg(x.charge_month order by x.charge_month), '[]'::jsonb)
                 from (select distinct charge_month from car_service_charges where company_id = v_co) x));
end $function$;
revoke all on function public.car_charges_month_load(date) from public, anon;
grant execute on function public.car_charges_month_load(date) to authenticated;

create or replace function public.car_charges_month_save(p_month date, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); m date := date_trunc('month', p_month)::date; v_key text; ln jsonb;
        v_veh uuid; v_amt numeric; v_notes text; v car_vehicles%rowtype; v_keep uuid[] := '{}'; v_blocked text;
        e record; v_total numeric; v_old_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not staff_has_perm('carsales.charges') then raise exception 'No access to Monthly Charges'; end if;
  v_key := v_co::text || '-' || to_char(m, 'YYYY-MM');

  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_veh := nullif(ln->>'vehicle_id','')::uuid;
    if v_veh is null then continue; end if;
    v_amt := round(coalesce((ln->>'amount')::numeric, 0), 2);
    v_notes := nullif(btrim(coalesce(ln->>'notes','')), '');
    if v_amt < 0 then raise exception 'A charge cannot be negative'; end if;
    select * into v from car_vehicles where id = v_veh and company_id = v_co;
    if not found then raise exception 'Vehicle not found'; end if;
    insert into car_service_charges(company_id, vehicle_id, contract_id, customer_id, charge_month, due_date, amount, notes)
    values (v_co, v.id, v.contract_id, v.current_customer_id, m, (m + interval '1 month')::date, v_amt, v_notes)
    on conflict (vehicle_id, charge_month) do update
      set amount = excluded.amount, notes = excluded.notes,
          contract_id = coalesce(car_service_charges.contract_id, excluded.contract_id),
          customer_id = coalesce(car_service_charges.customer_id, excluded.customer_id);
    v_keep := v_keep || v.id;
  end loop;

  -- Taken off the voucher: only a charge nothing has been paid against.
  select string_agg(v2.vehicle_no, ', ') into v_blocked
    from car_service_charges s join car_vehicles v2 on v2.id = s.vehicle_id
   where s.company_id = v_co and s.charge_month = m
     and not (s.vehicle_id = any(v_keep)) and coalesce(s.paid_amount, 0) > 0;
  if v_blocked is not null then
    raise exception 'A payment is recorded against % for this month, so that line cannot be removed.', v_blocked;
  end if;
  delete from car_service_charges s where s.company_id = v_co and s.charge_month = m and not (s.vehicle_id = any(v_keep));

  -- The month's voucher is rebuilt from what is on it now.
  select id, entry_no into e from journal_entries
   where company_id = v_co and source = 'car_scharge_month' and reference = v_key;
  if e.id is not null then
    v_old_no := e.entry_no;
    delete from journal_lines where entry_id = e.id;
    delete from journal_entries where id = e.id;
  end if;
  perform car_post_charges_month(v_co, m);
  select id, entry_no into e from journal_entries
   where company_id = v_co and source = 'car_scharge_month' and reference = v_key;
  select coalesce(sum(amount), 0) into v_total from car_service_charges where company_id = v_co and charge_month = m;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'car_charges_month_saved', 'car_service_charge_month', null,
          jsonb_build_object('month', m, 'total', v_total, 'lines', coalesce(array_length(v_keep, 1), 0),
                             'entry_no', e.entry_no, 'replaced', v_old_no));
  return jsonb_build_object('month', m, 'entry_id', e.id, 'entry_no', e.entry_no, 'total', v_total);
end $function$;
revoke all on function public.car_charges_month_save(date, jsonb) from public, anon;
grant execute on function public.car_charges_month_save(date, jsonb) to authenticated;

-- ── post-conditions ────────────────────────────────────────────────────────
do $chk$
declare v_bad int; v_n int; r jsonb; v_dr numeric; v_cr numeric; v_accts text; v_id uuid; v_sample uuid; v_co uuid;
begin
  -- Grants: internal routines closed, the two charge doors open to staff only.
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('trade_doc_post_now','trade_doc_raise','gl_post_internal','visa_invoice_generate','hotel_purchase_post_gl','transport_trip_post_gl')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  if v_bad > 0 then raise exception '377: % internal routine(s) still callable by a role', v_bad; end if;
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('car_charges_month_load','car_charges_month_save')
     and (not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  if v_bad > 0 then raise exception '377: the charge voucher routines are granted wrongly'; end if;
  select count(*) into v_n from acct_automation_rules where enabled and rule_key in ('visa.group_created','transport.trip_completed','hotel.vendor_confirmed');
  if v_n <> 3 then raise exception '377: the three raise rules are not all on (%)', v_n; end if;

  -- Rehearsal on real rows, rolled back: a hotel invoice, a transport invoice
  -- and a visa invoice are raised with no session, each posts four balanced
  -- legs to the right accounts, and the module row follows.
  begin
    select hp.id into v_sample from hotel_purchase_bookings hp join hotel_bookings b on b.id = hp.booking_id
     where hp.vendor_status::text in ('vendor_confirmed','hcn_pending','hcn_received') and b.agent_id is not null
       and hp.supplier_id is not null and hp.sale_total > 0 and hp.gl_posted_at is null limit 1;
    if v_sample is not null then
      r := hotel_purchase_post_gl(v_sample);
      if not coalesce((r->>'posted')::boolean, false) then raise exception '377 rehearsal: hotel not posted: %', r; end if;
      v_id := (r->>'id')::uuid;
      select sum(l.debit), sum(l.credit), string_agg(distinct a.name, ', ' order by a.name) into v_dr, v_cr, v_accts
        from trade_documents d join journal_lines l on l.entry_id = d.gl_entry join accounts a on a.id = l.account_id where d.id = v_id;
      if v_dr is null or v_dr <> v_cr then raise exception '377 rehearsal: hotel entry unbalanced (% / %)', v_dr, v_cr; end if;
      if v_accts not ilike '%Hotel Sales%' or v_accts not ilike '%Hotel Cost%' then raise exception '377 rehearsal: hotel accounts %', v_accts; end if;
      if not exists (select 1 from hotel_purchase_bookings where id = v_sample and gl_posted_at is not null) then raise exception '377 rehearsal: hotel row not marked'; end if;
      if (hotel_purchase_post_gl(v_sample)->>'reason') <> 'already invoiced' then raise exception '377 rehearsal: hotel raised twice'; end if;
      raise notice '377 rehearsal hotel ok: % → %', r->>'doc_no', v_accts;
    else
      raise notice '377 rehearsal hotel: no candidate row';
    end if;
    raise exception 'ROLLBACK_REHEARSAL';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
  end;

  begin
    select t.id into v_sample from transport_trips t join transport_bookings b on b.id = t.booking_id
     where t.status = 'completed' and b.agent_id is not null and t.vendor_id is not null and t.sell_rate > 0
       and t.gl_entry is null and not coalesce(t.cancelled_with_booking, false) limit 1;
    if v_sample is not null then
      r := transport_trip_post_gl(v_sample);
      if not coalesce((r->>'posted')::boolean, false) then raise exception '377 rehearsal: transport not posted: %', r; end if;
      v_id := (r->>'id')::uuid;
      select sum(l.debit), sum(l.credit), string_agg(distinct a.name, ', ' order by a.name) into v_dr, v_cr, v_accts
        from trade_documents d join journal_lines l on l.entry_id = d.gl_entry join accounts a on a.id = l.account_id where d.id = v_id;
      if v_dr is null or v_dr <> v_cr then raise exception '377 rehearsal: transport entry unbalanced'; end if;
      if v_accts not ilike '%Transport Sales%' or v_accts not ilike '%Transport Cost%' then raise exception '377 rehearsal: transport accounts %', v_accts; end if;
      if not exists (select 1 from transport_trips t join trade_documents d on d.id = v_id where t.id = v_sample and t.gl_entry = d.gl_entry) then raise exception '377 rehearsal: trip not marked'; end if;
      -- and the trip follows the voucher out
      delete from trade_document_lines where doc_id = v_id;
      delete from journal_lines where entry_id = (select gl_entry from trade_documents where id = v_id);
      delete from journal_entries where id = (select gl_entry from trade_documents where id = v_id);
      delete from trade_documents where id = v_id;
      if exists (select 1 from transport_trips where id = v_sample and gl_entry is not null) then raise exception '377 rehearsal: trip kept a deleted voucher'; end if;
      raise notice '377 rehearsal transport ok: % → %', r->>'doc_no', v_accts;
    else
      raise notice '377 rehearsal transport: no candidate row';
    end if;
    raise exception 'ROLLBACK_REHEARSAL';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
  end;

  begin
    select g.id into v_sample from umrah_groups g
     where g.agent_id is not null and coalesce(g.pax, 0) > 0
       and visa_pick_product(g.company_id, g.visa_type, coalesce(g.total_nights, 0)) is not null
       and not exists (select 1 from trade_documents d where d.doc_type = 'visa_invoice' and d.meta->>'source_id' = g.id::text)
     order by g.created_at desc limit 1;
    if v_sample is not null then
      v_id := visa_invoice_generate(v_sample);
      if v_id is null then raise exception '377 rehearsal: visa not raised'; end if;
      select sum(l.debit), sum(l.credit), string_agg(distinct a.name, ', ' order by a.name) into v_dr, v_cr, v_accts
        from trade_documents d join journal_lines l on l.entry_id = d.gl_entry join accounts a on a.id = l.account_id where d.id = v_id;
      if v_dr is null or v_dr <> v_cr then raise exception '377 rehearsal: visa entry unbalanced'; end if;
      if v_accts not ilike '%Visa Sales%' then raise exception '377 rehearsal: visa accounts %', v_accts; end if;
      if visa_invoice_generate(v_sample) <> v_id then raise exception '377 rehearsal: visa raised twice'; end if;
      raise notice '377 rehearsal visa ok: % → %', (select doc_no from trade_documents where id = v_id), v_accts;
    else
      raise notice '377 rehearsal visa: no candidate group';
    end if;
    raise exception 'ROLLBACK_REHEARSAL';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
  end;

  -- The monthly voucher, as the Super Admin, rolled back: load, save the same
  -- lines, the entry is rebuilt and balances.
  begin
    perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);
    v_co := auth_company_id();
    r := car_charges_month_load(current_date);
    if jsonb_array_length(r->'lines') = 0 then raise exception '377 rehearsal: no charge lines this month'; end if;
    r := car_charges_month_save(current_date,
           (select jsonb_agg(jsonb_build_object('vehicle_id', x->>'vehicle_id', 'amount', x->>'amount', 'notes', x->>'notes')) from jsonb_array_elements(r->'lines') x));
    if r->>'entry_no' is null then raise exception '377 rehearsal: month not posted %', r; end if;
    select sum(debit), sum(credit) into v_dr, v_cr from journal_lines where entry_id = (r->>'entry_id')::uuid;
    if v_dr <> v_cr or v_dr <> (r->>'total')::numeric then raise exception '377 rehearsal: month entry % / % vs %', v_dr, v_cr, r->>'total'; end if;
    raise notice '377 rehearsal charges ok: % total %', r->>'entry_no', r->>'total';
    raise exception 'ROLLBACK_REHEARSAL';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
  end;
  raise notice '377 ok';
end $chk$;

commit;
