-- The Air Ticket Invoice: one voucher, two parties, four legs.
--
-- Every other trade document has ONE party. A ticket does not: it is bought
-- from a consolidator and sold to the passenger in the same breath, and the
-- whole point of the document is the margin between those two numbers. Split
-- across a Purchase Voucher and a Sales Invoice, the two halves are two
-- documents that nothing ties together, and the margin on a ticket becomes a
-- question you answer with a spreadsheet.
--
-- So it posts both sides at once:
--
--     Dr the customer         gross            Cr Air Ticket Sales    gross
--     Dr Air Ticket Cost      supplier cost    Cr the supplier        supplier cost
--
-- The customer stands as a receivable and the consolidator as a payable, which
-- is what was asked for, and the margin falls out of the two revenue/cost
-- accounts without anybody typing it anywhere.
--
-- WHERE THE SECOND PARTY LIVES. trade_documents.party_id is the customer,
-- because that is the party the document is addressed to and the one every
-- existing report reads. The supplier rides in meta->>'supplier_id'. It is
-- picked from `parties` like any other, so it is the same master the rest of
-- the ERP uses — an account with no parties row behind it is invisible to every
-- picker, and this is not the place to introduce a second kind of supplier.
--
-- IT MOVES NO STOCK, and that had to be said explicitly rather than left to
-- fall out. v_upd_stock defaults to TRUE for anything that is not a Sales
-- Invoice with the tick unticked, so without the line below an air ticket line
-- pointing at a stock item would have issued goods from a warehouse. A ticket
-- is not on a shelf.
--
-- CURRENCY. The grid is typed in the document's own currency and the ledger is
-- posted in the company's, at meta->>'fx_rate'. Absent, zero or negative means
-- 1, so every SAR document behaves exactly as it did. trade_doc_fx() is where
-- that is decided, once, and trade_doc_post uses it too — the authorisation
-- threshold has to be measured in the same money the rule was written in, or
-- "over 100,000" means something different on a USD voucher.
--
-- WHY THE SUPPLIER IS REFUSED RATHER THAN SKIPPED. If the lines carry a
-- supplier cost and no supplier is chosen, the cost has nowhere to be credited.
-- Posting the sale alone would leave a document whose margin reads as 100% and
-- a consolidator who is never shown as owed. It raises instead.

begin;

-- ── the rate the ledger converts at ───────────────────────────────────────
create or replace function public.trade_doc_fx(p_meta jsonb)
returns numeric
language sql
immutable
as $f$
  select case when coalesce((p_meta->>'fx_rate')::numeric, 1) > 0
              then coalesce((p_meta->>'fx_rate')::numeric, 1)
              else 1 end;
$f$;

-- ── the gate ──────────────────────────────────────────────────────────────
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
  if d.doc_type not in ('purchase_voucher','purchase_return','sales_return','sales_invoice','air_ticket_invoice') then
    raise exception 'This document type does not post to the GL';
  end if;
  if d.status = 'awaiting_approval' then
    raise exception 'This voucher is already awaiting authorisation.';
  end if;

  -- In the company's own money, so an amount threshold means the same thing on
  -- a foreign-currency voucher as on a SAR one. Everything without a rate on it
  -- converts at 1 and is unchanged.
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

-- ── the posting ───────────────────────────────────────────────────────────
create or replace function public.trade_doc_post_now(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d trade_documents; v_co uuid := auth_company_id(); ln record; is_stk boolean; prc numeric;
        v_stock numeric(18,2) := 0; v_other numeric(18,2) := 0; v_cogs_val numeric(18,2) := 0;
        v_party uuid; v_inv uuid; v_pur uuid; v_sr uuid; v_cogs uuid; v_ro uuid; v_veh uuid; v_sale uuid;
        lines jsonb := '[]'::jsonb; g jsonb; v_dr numeric(18,2); v_cr numeric(18,2); v_diff numeric(18,2); mv jsonb;
        v_upd_stock boolean; v_wh uuid; v_acct uuid; v_is_car boolean; v_car_cost numeric(18,2) := 0;
        v_fx numeric; v_sell numeric(18,2); v_supcost numeric(18,2); v_sup uuid; v_sup_acct uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.gl_entry is not null then raise exception 'Already posted'; end if;
  if d.doc_type not in ('purchase_voucher','purchase_return','sales_return','sales_invoice','air_ticket_invoice') then
    raise exception 'This document type does not post to the GL';
  end if;

  -- Update Stocks: absent means true (documents predating the option). A Sales
  -- Invoice has no say in it — selling is what moves the goods.
  v_upd_stock := d.doc_type = 'sales_invoice'
                 or coalesce((d.meta->>'update_stock')::boolean, true);
  v_is_car := is_car_cost_center(d.cost_center);
  -- A car return moves a car_vehicles row, not a stock line. Its stock is
  -- handled by car_return_apply putting the vehicle back in stock, which is
  -- what the vehicle stock sync watches — so the line loop must not move it a
  -- second time, whatever the Update Stocks tick says or the cost centre reads.
  if d.source_car_contract is not null and d.doc_type = 'sales_return' then
    v_upd_stock := false;
  end if;
  -- AN AIR TICKET IS NOT GOODS. The default above is "true unless told
  -- otherwise", so a ticket line pointing at a stock item would have issued it
  -- from a warehouse. Said here rather than relied on not happening.
  if d.doc_type = 'air_ticket_invoice' then
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
        -- Sold: the goods leave at what they actually cost us.
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
    else -- purchase_return
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

  -- ── THE AIR TICKET INVOICE ──────────────────────────────────────────────
  elsif d.doc_type = 'air_ticket_invoice' then
    v_fx := trade_doc_fx(d.meta);
    v_party := ensure_party_account(v_co, d.party_id, 'customer');
    v_sell := round(coalesce(d.total, 0) * v_fx, 2);

    -- What the tickets cost, off the lines. Per line rather than a header box,
    -- because a single invoice carries several passengers at several fares and
    -- a document-level cost could not be read back against any of them.
    select round(coalesce(sum(round(coalesce((l.meta->>'supplier_amount')::numeric, 0), 2)), 0) * v_fx, 2)
      into v_supcost
      from trade_document_lines l where l.doc_id = p_id;
    v_supcost := coalesce(v_supcost, 0);

    if v_sell = 0 and v_supcost = 0 then
      raise exception 'This air ticket invoice is for nothing — enter the fare, or the supplier cost, or both.';
    end if;

    if v_sell <> 0 then
      v_sale := acct_ensure_named(v_co, 'Air Ticket Sales', 'income', '4', 'Revenue');
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_party::text, 'debit', v_sell, 'credit', 0,
                           'description', coalesce(d.narration, d.doc_no)),
        jsonb_build_object('account_id', v_sale::text, 'debit', 0, 'credit', v_sell,
                           'description', 'Air ticket '||d.doc_no, 'cost_center', d.cost_center,
                           'tag_area', d.tag_area));
    end if;

    if v_supcost <> 0 then
      v_sup := nullif(d.meta->>'supplier_id','')::uuid;
      if v_sup is null then
        raise exception 'The tickets on this invoice cost %, but no supplier is chosen. Pick the supplier they were bought from — the cost has to be owed to somebody.', v_supcost;
      end if;
      v_sup_acct := ensure_party_account(v_co, v_sup, 'supplier');
      v_cogs := acct_ensure_named(v_co, 'Air Ticket Cost', 'expense', '5', 'COGS');
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_cogs::text, 'debit', v_supcost, 'credit', 0,
                           'description', 'Air ticket cost '||d.doc_no, 'cost_center', d.cost_center),
        jsonb_build_object('account_id', v_sup_acct::text, 'debit', 0, 'credit', v_supcost,
                           'description', 'Air ticket cost '||d.doc_no));
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

    -- CAR RETURN. The vehicle is not a stock line — it is a car_vehicles row
    -- with its own stock stream — so its cost has to be found from the Car
    -- Invoice rather than from the loop above. Same pair a goods return posts,
    -- against the vehicle account instead of Inventory.
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

  g := gl_post(v_co, d.doc_date, coalesce(d.narration, d.doc_no), 'gl_trade_'||d.doc_type, d.doc_type, d.doc_no, lines);
  update trade_documents set gl_entry = (g->>'entry_id')::uuid, posted_at = now(), status = 'posted',
    warehouse_id = coalesce(warehouse_id, case when v_upd_stock then v_wh end)
  where id = p_id;
  return jsonb_build_object('posted', true, 'entry_no', g->>'entry_no');
end $function$;

-- ── saving posts it, like every other voucher that posts ──────────────────
create or replace function public.trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0;
  v_sub numeric(18,2) := 0; v_round numeric(18,2); v_disc numeric(18,2); v_total numeric(18,2);
  v_src uuid; v_car uuid; v_status text; v_gl uuid; v_posted jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then perform staff_require_doc(p_type, 'create');
  else perform staff_require_trade_right(p_id, 'edit'); end if;
  perform staff_require_scope_products(p_lines);

  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
  v_disc  := round(coalesce((p_header->'meta'->>'discount')::numeric, 0), 2);
  v_src := nullif(p_header->>'source_doc_id','')::uuid;
  v_car := nullif(p_header->>'source_car_contract','')::uuid;

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
    -- Editing a POSTED voucher: undo what it did, then let the save below post
    -- it again from what was actually typed. One transaction.
    if v_gl is not null then
      perform staff_require_doc_strict(p_type, 'edit_posted');
      perform trade_doc_unpost(v_id, 'edited');
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
      coalesce(p_header->'meta','{}'::jsonb), v_src, v_car, auth.uid())
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
      meta = coalesce(p_header->'meta','{}'::jsonb),
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

  if p_type in ('purchase_voucher','purchase_return','sales_return','sales_invoice','air_ticket_invoice') then
    v_posted := trade_doc_post(v_id);
  end if;
  return coalesce(v_posted, '{}'::jsonb) || jsonb_build_object('id', v_id, 'doc_no', v_no);
end $function$;

do $chk$
declare v_n int;
begin
  -- all three routines must know the new type
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='trade_doc_post_now') not like '%air_ticket_invoice%'
  then raise exception '358: trade_doc_post_now does not know the air ticket invoice'; end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='trade_doc_post') not like '%air_ticket_invoice%'
  then raise exception '358: trade_doc_post does not know the air ticket invoice'; end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='trade_doc_save') not like '%air_ticket_invoice%'
  then raise exception '358: trade_doc_save does not post the air ticket invoice'; end if;

  -- And an air ticket must never reach the stock loop. Checked as the exact two
  -- lines, not as two fragments that happen to both appear — 'air_ticket_invoice'
  -- occurs four times in this body and a loose LIKE would pass on any of them.
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='trade_doc_post_now')
     not like E'%if d.doc_type = \'air_ticket_invoice\' then\n    v_upd_stock := false;%'
  then raise exception '358: an air ticket invoice is not excluded from the stock loop'; end if;

  -- the conversion rate: absent, zero and negative all mean 1
  if trade_doc_fx('{}'::jsonb) <> 1 then raise exception '358: no rate is not 1'; end if;
  if trade_doc_fx('{"fx_rate":0}'::jsonb) <> 1 then raise exception '358: a zero rate is not 1'; end if;
  if trade_doc_fx('{"fx_rate":-2}'::jsonb) <> 1 then raise exception '358: a negative rate is not 1'; end if;
  if trade_doc_fx('{"fx_rate":3.75}'::jsonb) <> 3.75 then raise exception '358: a real rate is not read'; end if;
end $chk$;

commit;
