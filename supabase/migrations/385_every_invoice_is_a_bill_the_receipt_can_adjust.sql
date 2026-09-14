-- ============================================================
-- 385 — Every invoice is a bill the receipt can adjust against
--
-- The Receipt, Payment and Journal vouchers carry a bill-wise adjustment: put
-- an amount on a customer's line and the popup lists that customer's open
-- bills to set it against. It never appeared, because only the Bill Record
-- ever wrote an open item — the trade vouchers, the Car Invoice and the
-- Monthly Charges posted the customer's debit and wrote no bill at all. So
-- the table the popup reads was empty, and a receipt of 10,000 against a
-- customer owing 123,000 had nothing to say which invoice it paid.
--
-- Now every posting that debits a customer or credits a supplier raises the
-- bill (open_item_raise): the Sales Invoice and the four service invoices for
-- the customer (and the supplier's cost leg for the supplier), the Purchase
-- Voucher for the supplier, the two returns as credit notes, the Car Invoice
-- and each customer's line of the Monthly Charges voucher. And the bill goes
-- WITH its voucher: a trigger on journal_entries removes an entry's bills
-- when the entry is unposted — refusing if a receipt has been adjusted
-- against them — and gives back what a deleted receipt had settled. One rule
-- for every unpost path, rather than one per routine.
--
-- The three entries already on the ledger get their bills, and RCT-00001 is
-- adjusted against CI-000005, which is what the popup would have done.
--
-- Also: the ledger entry of a Stock Receipt / Issue and of a Bill Record
-- carries the document's own number when the one-number setting is on, the
-- same as the trade vouchers and the car postings already do.
-- ============================================================
begin;

-- ── the bill ───────────────────────────────────────────────────────────────
create or replace function public.open_item_raise(
  p_company uuid, p_entry uuid, p_account uuid, p_direction text, p_doc_type text, p_doc_no text,
  p_doc_date date, p_due date, p_amount numeric)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_party uuid;
begin
  if p_account is null or round(coalesce(p_amount, 0), 2) <= 0 then return null; end if;
  select party_id into v_party from accounts where id = p_account;
  -- one bill per (entry, account): a re-run adds nothing
  select id into v_id from open_items where entry_id = p_entry and account_id = p_account and direction = p_direction;
  if v_id is not null then return v_id; end if;
  insert into open_items(company_id, account_id, party_id, direction, doc_type, doc_no, doc_date, due_date,
                         currency, amount_base, outstanding_base, entry_id, status)
  values (p_company, p_account, v_party, p_direction, p_doc_type, p_doc_no, coalesce(p_doc_date, current_date), p_due,
          'SAR', round(p_amount, 2), round(p_amount, 2), p_entry, 'open')
  returning id into v_id;
  return v_id;
end $function$;
revoke all on function public.open_item_raise(uuid, uuid, uuid, text, text, text, date, date, numeric) from public, anon, authenticated;

-- ── the bill goes with its voucher ─────────────────────────────────────────
create or replace function public.journal_entry_release_open_items()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_settled text;
begin
  -- What this entry had settled is given back to the bills it settled.
  update open_items oi
     set outstanding_base = oi.outstanding_base + s.amt, status = 'open'
    from (select open_item_id, sum(amount_base) as amt from allocations where settle_entry_id = old.id group by 1) s
   where s.open_item_id = oi.id;
  delete from allocations where settle_entry_id = old.id;
  -- A bill something else has settled against cannot go.
  select string_agg(distinct e.entry_no, ', ') into v_settled
    from allocations a join open_items oi on oi.id = a.open_item_id join journal_entries e on e.id = a.settle_entry_id
   where oi.entry_id = old.id;
  if v_settled is not null then
    raise exception '% has been adjusted against by % — reverse that first, then this can be changed.', old.entry_no, v_settled;
  end if;
  delete from open_items where entry_id = old.id;
  return old;
end $function$;
drop trigger if exists trg_journal_entry_release_open_items on public.journal_entries;
create trigger trg_journal_entry_release_open_items
  before delete on public.journal_entries
  for each row execute function public.journal_entry_release_open_items();

-- ── the car postings raise theirs ──────────────────────────────────────────
create or replace function public.car_post_entry(p_company uuid, p_date date, p_memo text, p_source text, p_reference text, p_lines jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_entry uuid; v_no text; v_one boolean; l record;
begin
  if exists (select 1 from journal_entries where company_id = p_company and source = p_source and reference = p_reference) then
    return false;
  end if;
  v_one := coalesce((select value = 'true' from erp_settings where key = 'ledger_uses_doc_no'), false);
  if p_source = 'car_scharge_month' then
    v_no := next_doc_number(p_company, 'car_scharge_month');
  elsif v_one and p_reference ~ '^[A-Z]{2,5}-[0-9]+$'
        and not exists (select 1 from journal_entries where company_id = p_company and entry_no = p_reference) then
    v_no := p_reference;
  else
    v_no := next_doc_number(p_company, 'journal');
  end if;
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference, created_by)
  values (p_company, v_no, coalesce(p_date, current_date), p_memo, 'posted', p_source, p_reference, auth.uid())
  returning id into v_entry;
  insert into journal_lines(entry_id, account_id, description, debit, credit, cost_center, tag_area)
  select v_entry,
         coalesce(nullif(l->>'account_id','')::uuid, acct(p_company, l->>'code')),
         p_memo,
         round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
         nullif(btrim(coalesce(l->>'cost_center','')), ''),
         nullif(btrim(coalesce(l->>'tag_area','')), '')
  from jsonb_array_elements(p_lines) l
  where coalesce((l->>'debit')::numeric, 0) <> 0 or coalesce((l->>'credit')::numeric, 0) <> 0;
  -- A car sale and a month of charges are bills: one per customer debited.
  if p_source in ('car_sale', 'car_scharge_month') then
    for l in select jl.account_id, jl.debit from journal_lines jl join accounts a on a.id = jl.account_id
              where jl.entry_id = v_entry and jl.debit > 0 and a.subtype = 'Receivable' loop
      perform open_item_raise(p_company, v_entry, l.account_id, 'D', p_source, v_no, coalesce(p_date, current_date), null, l.debit);
    end loop;
  end if;
  return true;
end $function$;

-- ── the trade vouchers raise theirs ────────────────────────────────────────
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
    perform open_item_raise(v_co, (g->>'entry_id')::uuid, v_party, 'C', d.doc_type, d.doc_no, d.doc_date, d.due_date, d.total);
  elsif d.doc_type = 'purchase_return' then
    perform open_item_raise(v_co, (g->>'entry_id')::uuid, v_party, 'D', d.doc_type, d.doc_no, d.doc_date, null, d.total);
  elsif d.doc_type = 'sales_return' then
    perform open_item_raise(v_co, (g->>'entry_id')::uuid, v_party, 'C', d.doc_type, d.doc_no, d.doc_date, null, d.total);
  end if;
  return jsonb_build_object('posted', true, 'entry_no', g->>'entry_no');
end $function$;
revoke all on function public.trade_doc_post_now(uuid) from public, anon, authenticated;

-- ── one number for the stock documents and the Bill Record too ─────────────
create or replace function public.gl_post(p_company uuid, p_date date, p_memo text, p_doc_type text, p_source text, p_reference text, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_entry uuid; v_no text; ln jsonb; d numeric(18,2); c numeric(18,2); v_closed date;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select closed_through into v_closed from acct_settings where company_id = p_company;
  if v_closed is not null and p_date <= v_closed then
    raise exception 'Period is closed through % — cannot post on %', v_closed, p_date;
  end if;
  perform gl_validate(p_company, p_lines);
  if p_doc_type in ('gl_stock_in', 'gl_stock_out', 'gl_sales', 'gl_purchase')
     and p_reference ~ '^[A-Z]{2,5}-[0-9]+$'
     and coalesce((select value = 'true' from erp_settings where key = 'ledger_uses_doc_no'), false)
     and not exists (select 1 from journal_entries where company_id = p_company and entry_no = p_reference) then
    v_no := p_reference;
  else
    v_no := next_doc_number(p_company, p_doc_type);
  end if;
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference)
  values (p_company, v_no, p_date, p_memo, 'posted', p_source, p_reference)
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

-- ── the bills already on the ledger ────────────────────────────────────────
-- CI-000005 and MSC-00001 for the customer, PV-00003 for the supplier, off
-- the entries' own party lines.
do $$
declare e record;
begin
  for e in select je.id, je.company_id, je.entry_no, je.entry_date, je.source, jl.account_id, jl.debit, jl.credit
             from journal_entries je join journal_lines jl on jl.entry_id = je.id join accounts a on a.id = jl.account_id
            where je.source in ('car_sale', 'car_scharge_month', 'purchase_voucher') and a.subtype in ('Receivable', 'Payable')
  loop
    if e.debit > 0 then
      perform open_item_raise(e.company_id, e.id, e.account_id, 'D', e.source, e.entry_no, e.entry_date, null, e.debit);
    elsif e.credit > 0 then
      perform open_item_raise(e.company_id, e.id, e.account_id, 'C', e.source, e.entry_no, e.entry_date, null, e.credit);
    end if;
  end loop;
end $$;
-- RCT-00001 pays CI-000005, the customer's only bill on that day.
do $$
declare r record; v_taken numeric;
begin
  select je.id, je.company_id, jl.account_id, jl.credit into r
    from journal_entries je join journal_lines jl on jl.entry_id = je.id join accounts a on a.id = jl.account_id
   where je.entry_no = 'RCT-00001' and a.subtype = 'Receivable' and jl.credit > 0;
  if r.id is not null and not exists (select 1 from allocations where settle_entry_id = r.id) then
    v_taken := allocate_fifo(r.company_id, r.account_id, r.id, r.credit, 'Adjusted against the open bill (migration 385)');
    if v_taken <> r.credit then raise exception '385: RCT-00001 adjusted % of %', v_taken, r.credit; end if;
  end if;
end $$;

-- ── post-conditions ────────────────────────────────────────────────────────
do $chk$
declare v_n int; v_out numeric; v_id uuid; v_msg text;
begin
  select count(*) into v_n from open_items;
  if v_n <> 3 then raise exception '385: expected 3 bills, found %', v_n; end if;
  select outstanding_base into v_out from open_items where doc_no = 'CI-000005';
  if v_out <> 113000 then raise exception '385: CI-000005 outstanding is %, not 113,000', v_out; end if;
  if (select count(*) from allocations) <> 1 then raise exception '385: expected one allocation'; end if;

  -- Rehearsal, rolled back: deleting the receipt gives the bill back; deleting
  -- the invoice while the receipt stands is refused.
  begin
    begin
      delete from journal_lines where entry_id = (select id from journal_entries where entry_no = 'CI-000005');
      delete from journal_entries where entry_no = 'CI-000005';
      raise exception '385 rehearsal: the settled invoice was deleted';
    exception when others then
      if sqlerrm not like '%adjusted against by RCT-00001%' then raise; end if;
    end;
    raise exception 'ROLLBACK_REHEARSAL';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
  end;
  begin
    select id into v_id from journal_entries where entry_no = 'RCT-00001';
    delete from journal_lines where entry_id = v_id;
    delete from journal_entries where id = v_id;
    select outstanding_base into v_out from open_items where doc_no = 'CI-000005';
    if v_out <> 123000 then raise exception '385 rehearsal: bill not given back (%)', v_out; end if;
    if exists (select 1 from allocations) then raise exception '385 rehearsal: allocation survived its receipt'; end if;
    raise exception 'ROLLBACK_REHEARSAL';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
  end;
  if (select count(*) from allocations) <> 1 or (select outstanding_base from open_items where doc_no = 'CI-000005') <> 113000 then
    raise exception '385: the rehearsal did not roll back';
  end if;
  raise notice '385 ok';
end $chk$;

commit;
