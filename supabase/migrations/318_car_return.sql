-- A car comes back: Sales Return, loaded from the Car Invoice that sold it.
--
-- Until now the only way to undo a car sale was to reverse the receipt and
-- delete the Car Invoice, which is not what happened. The customer bought the
-- car, kept it for months, and has now brought it back. Deleting the sale says
-- it never took place — the income disappears from the month it was earned in,
-- the cost of sale with it, and the car reappears in stock with no record of
-- where it had been.
--
-- A return is its own event, on its own date, and this is the route for it:
--
--     Car Invoice  ──►  Sales Return
--
-- exactly the way a Car Invoice already feeds a Delivery Note. Nothing about
-- the original sale is touched.
--
-- WHAT IT POSTS
-- -------------
-- The return value is TYPED — what the car is worth coming back is a
-- negotiation, not a formula, so the Load fills in the vehicle and leaves the
-- amount at zero with the original selling price shown beside it.
--
--     Sales Returns   dr  return value      the income earned is given back
--     Customer        cr  return value      taken off what they owe
--     Vehicle Stock   dr  vehicle cost      the car is an asset again
--     Cost of Sales   cr  vehicle cost      its cost of sale unwinds
--
-- The first two lines are what trade_doc_post_now already writes for any Sales
-- Return. The vehicle pair is new, and is the car equivalent of the stock lines
-- a goods return posts — a car is not in stock_balances under the document, it
-- is a car_vehicles row with its own stock stream, so it could not come from
-- the line loop.
--
-- WHO OWES WHOM IS THE LEDGER'S ANSWER, NOT THIS DOCUMENT'S. The credit lands
-- on the customer's account and the BALANCE there decides: still a debtor and
-- they keep paying by Receipt Voucher; in credit and we owe them, paid out by
-- Payment Voucher. There is no refund field, because a refund is a payment and
-- payments are made on the payment screen.
--
-- WHAT HAPPENS TO THE CAR AND THE INVOICE
-- ---------------------------------------
-- Posting the return puts the vehicle back to `in_stock` — which makes the
-- existing car_vehicle_stock_sync trigger receive it into the car warehouse
-- again, at its cost, with no help from here — and flags it `returned_at` so it
-- is visibly a car that came back rather than one that never left. The Car
-- Invoice goes to `cancelled` and records which return did it, so every car
-- report (all of which already skip cancelled invoices) stops counting it.
--
-- Deleting or editing the Sales Return puts all of that back, because
-- trade_doc_unpost is where the undo lives.
--
-- Requires 315 (trade_doc_unpost) and 317 (net_payable). Reversible: see the
-- rollback.

-- ------------------------------------------------------------- the flags ----

alter table car_vehicles  add column if not exists returned_at date;
alter table car_vehicles  add column if not exists returned_from_contract uuid;
alter table car_contracts add column if not exists returned_at date;
alter table car_contracts add column if not exists returned_doc_id uuid;

comment on column car_vehicles.returned_at is
  'Set when a Sales Return brought this vehicle back. It is in stock again, but it is a returned car.';
comment on column car_contracts.returned_doc_id is
  'The Sales Return that reversed this sale. The invoice is cancelled, but it happened.';

create index if not exists car_vehicles_returned_idx on car_vehicles (company_id, returned_at)
  where returned_at is not null;

-- ------------------------------------------------------------ the picker ----
-- A Car Invoice that has not been returned yet shows up in the Sales Return's
-- Load list, beside nothing else — a Sales Return has no step in workflow_steps,
-- so this union is the whole of its list.

create or replace function trade_doc_pending(p_target_type text)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with docs as (
    select d.id, d.doc_no, d.doc_date,
           (select p.name from parties p where p.id = d.party_id) party_name,
           d.cost_center, d.reference, d.total,
           (select count(*) from trade_document_lines l where l.doc_id = d.id) lines,
           'trade' as source_kind
    from trade_documents d
    where d.company_id = auth_company_id()
      and d.doc_type = trade_doc_source_type(p_target_type)
      and coalesce(d.status, 'open') not in ('cancelled', 'closed', 'awaiting_approval')
      and not exists (
        select 1 from trade_documents t
        where t.company_id = d.company_id and t.doc_type = p_target_type and t.source_doc_id = d.id)
      and (p_target_type <> 'sales_invoice' or not is_car_cost_center(d.cost_center))
    union all
    -- A Car Invoice feeds two documents: the Delivery Note that hands the car
    -- over, and the Sales Return that takes it back.
    select c.id, c.contract_no, c.contract_date,
           (select p.name from parties p where p.id = c.customer_id),
           'CAR SALES', null,
           case when p_target_type = 'sales_return' then c.net_payable else c.sale_price end,
           1, 'car'
    from car_contracts c
    where p_target_type in ('delivery_note', 'sales_return')
      and c.company_id = auth_company_id()
      and c.status in ('active', 'completed')
      and not exists (
        select 1 from trade_documents t
        where t.company_id = c.company_id and t.doc_type = p_target_type and t.source_car_contract = c.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'doc_no', doc_no, 'doc_date', doc_date, 'party_name', party_name,
    'cost_center', cost_center, 'reference', reference, 'total', total,
    'lines', lines, 'source_kind', source_kind)
    order by doc_date desc, doc_no desc), '[]'::jsonb)
  from docs;
$function$;

revoke all on function trade_doc_pending(text) from public, anon;
grant execute on function trade_doc_pending(text) to authenticated;

-- -------------------------------------------------------------- the load ----

create or replace function trade_doc_load(p_source uuid, p_target_type text)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare d trade_documents; c car_contracts; v_src text; v_co uuid := auth_company_id();
        v_item text; v_prod uuid; v_veh car_vehicles;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  -- A Delivery Note and a Sales Return may both be raised from a Car Invoice.
  if p_target_type in ('delivery_note', 'sales_return') then
    select * into c from car_contracts where id = p_source and company_id = v_co;
    if found then
      if exists (select 1 from trade_documents t where t.company_id = v_co
                 and t.doc_type = p_target_type and t.source_car_contract = p_source) then
        raise exception 'Car Invoice % has already been loaded into a %.', c.contract_no, p_target_type;
      end if;
      select * into v_veh from car_vehicles where id = c.vehicle_id;
      select coalesce(p.name, concat_ws(' ', v_veh.make, v_veh.model, v_veh.model_year::text, v_veh.color), v_veh.vehicle_no)
        into v_item from acct_products p where p.id = v_veh.product_id;
      v_item := coalesce(v_item, concat_ws(' ', v_veh.make, v_veh.model, v_veh.model_year::text, v_veh.color), v_veh.vehicle_no);
      v_prod := v_veh.product_id;

      if p_target_type = 'sales_return' then
        if c.status not in ('active', 'completed') then
          raise exception 'Car Invoice % is %, so there is nothing to return.', c.contract_no, c.status;
        end if;
        -- The line comes across with the vehicle named and the RATE LEFT BLANK:
        -- what the car is worth coming back is typed, not derived. What it was
        -- sold for rides along in meta so the screen can show it beside the box.
        return jsonb_build_object(
          'id', c.id, 'doc_type', 'car_invoice', 'doc_no', c.contract_no, 'doc_date', current_date,
          'party_id', c.customer_id, 'cost_center', coalesce(c.cost_center, 'CAR SALES'), 'tag_area', c.tag_area,
          'reference', c.contract_no,
          'narration', 'Return of vehicle ' || coalesce(v_veh.vehicle_no, '') || ' against ' || c.contract_no,
          'terms', null, 'mode_of_payment', null, 'due_date', null, 'delivery_date', null, 'total', 0,
          'meta', jsonb_build_object('car_return', true, 'vehicle_no', v_veh.vehicle_no,
                                     'sold_for', c.net_payable, 'vehicle_cost', v_veh.total_cost,
                                     'update_stock', false),
          'source_kind', 'car',
          'lines', jsonb_build_array(jsonb_build_object(
            'product_id', v_prod, 'item_name', v_item, 'units', 'NOS',
            'quantity', 1, 'rate', 0, 'amount', 0, 'meta', '{}'::jsonb)));
      end if;

      return jsonb_build_object(
        'id', c.id, 'doc_type', 'car_invoice', 'doc_no', c.contract_no, 'doc_date', c.contract_date,
        'party_id', c.customer_id, 'cost_center', 'CAR SALES', 'tag_area', null,
        'reference', c.contract_no, 'narration', c.notes, 'terms', null, 'mode_of_payment', null,
        'due_date', null, 'delivery_date', c.delivery_date, 'total', c.sale_price,
        'meta', '{}'::jsonb, 'source_kind', 'car',
        'lines', jsonb_build_array(jsonb_build_object(
          'product_id', v_prod, 'item_name', v_item, 'units', 'NOS',
          'quantity', 1, 'rate', c.sale_price, 'amount', c.sale_price, 'meta', '{}'::jsonb)));
    end if;
  end if;

  v_src := trade_doc_source_type(p_target_type);
  if v_src is null then raise exception 'This voucher is not loaded from another document.'; end if;

  select * into d from trade_documents where id = p_source and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.doc_type <> v_src then raise exception 'A % is loaded from a %, not from a %.', p_target_type, v_src, d.doc_type; end if;
  if exists (select 1 from trade_documents t where t.doc_type = p_target_type and t.source_doc_id = p_source
             and t.company_id = d.company_id) then
    raise exception '% % has already been loaded into a %.', v_src, d.doc_no, p_target_type;
  end if;

  return trade_doc_get(p_source) || jsonb_build_object('source_kind', 'trade');
end $function$;

revoke all on function trade_doc_load(uuid, text) from public, anon;
grant execute on function trade_doc_load(uuid, text) to authenticated;

-- ------------------------------------------------------------ the effect ----
-- Applying and undoing a car return, in one place, so the two cannot drift.

create or replace function car_return_apply(p_doc uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare d trade_documents; c car_contracts; v_co uuid;
begin
  select * into d from trade_documents where id = p_doc;
  if not found or d.doc_type <> 'sales_return' or d.source_car_contract is null then
    return jsonb_build_object('applied', false);
  end if;
  v_co := d.company_id;

  select * into c from car_contracts where id = d.source_car_contract and company_id = v_co;
  if not found then raise exception 'The Car Invoice this return came from is gone.'; end if;

  -- The car is ours again. Setting it in_stock is what makes
  -- car_vehicle_stock_sync receive it back into the car warehouse.
  update car_vehicles set
    status = 'in_stock', ownership = 'vista',
    current_customer_id = null, contract_id = null,
    returned_at = d.doc_date, returned_from_contract = c.id, updated_at = now()
  where id = c.vehicle_id and company_id = v_co;

  update car_contracts set
    status = 'cancelled', returned_at = d.doc_date, returned_doc_id = p_doc, updated_at = now()
  where id = c.id and company_id = v_co;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'car_returned', 'car_contract', c.id,
          jsonb_build_object('contract_no', c.contract_no, 'return_doc', d.doc_no,
                             'return_value', d.total, 'sold_for', c.net_payable,
                             'vehicle_id', c.vehicle_id));

  return jsonb_build_object('applied', true, 'contract_no', c.contract_no, 'vehicle_id', c.vehicle_id);
end $function$;

create or replace function car_return_undo(p_doc uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare d trade_documents; c car_contracts; v_co uuid;
begin
  select * into d from trade_documents where id = p_doc;
  if not found or d.doc_type <> 'sales_return' or d.source_car_contract is null then
    return jsonb_build_object('undone', false);
  end if;
  v_co := d.company_id;

  select * into c from car_contracts where id = d.source_car_contract and company_id = v_co;
  if not found then return jsonb_build_object('undone', false); end if;
  -- Only undo the return THIS document did. If the invoice was cancelled by
  -- something else, or a different return claimed it, leave it alone.
  if c.returned_doc_id is distinct from p_doc then return jsonb_build_object('undone', false); end if;

  -- Sold again. The stock sync issues it back out of the car warehouse.
  update car_vehicles set
    status = 'sold', current_customer_id = c.customer_id, contract_id = c.id,
    returned_at = null, returned_from_contract = null, updated_at = now()
  where id = c.vehicle_id and company_id = v_co;

  update car_contracts set
    status = 'active', returned_at = null, returned_doc_id = null, updated_at = now()
  where id = c.id and company_id = v_co;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'car_return_undone', 'car_contract', c.id,
          jsonb_build_object('contract_no', c.contract_no, 'return_doc', d.doc_no));

  return jsonb_build_object('undone', true, 'contract_no', c.contract_no);
end $function$;

revoke all on function car_return_apply(uuid) from public, anon, authenticated;
revoke all on function car_return_undo(uuid)  from public, anon, authenticated;

-- ------------------------------------------------------------- the trigger --
-- Same shape as car_pv_vehicle_autocreate: it fires when the document acquires
-- a GL entry, i.e. the moment it posts, and never on an unposted edit. A
-- failure is logged rather than thrown, so a bookkeeping problem with the car
-- record cannot roll back a posted ledger entry.

create or replace function car_return_trigger()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_err text; v_state text; v_ctx text;
begin
  if new.gl_entry is not null
     and coalesce(old.gl_entry, '00000000-0000-0000-0000-000000000000'::uuid) is distinct from new.gl_entry
     and new.doc_type = 'sales_return' and new.source_car_contract is not null then
    begin
      perform car_return_apply(new.id);
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
      raise warning 'car_return_apply failed for % (%): % [%]', new.id, new.doc_no, v_err, v_state;
      begin
        insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (new.company_id, auth.uid(), 'car_return_apply_failed', 'trade_document', new.id,
                jsonb_build_object('error', v_err, 'sqlstate', v_state, 'context', v_ctx, 'doc_no', new.doc_no));
      exception when others then null; end;
    end;
  end if;
  return new;
end $function$;

drop trigger if exists trg_car_return on trade_documents;
create trigger trg_car_return after insert or update on trade_documents
for each row execute function car_return_trigger();

-- A new function comes into the world with EXECUTE to PUBLIC, and anon is a
-- member of PUBLIC — the very thing migration 316 was written to fix. A trigger
-- function cannot actually be called over PostgREST (it returns `trigger`), but
-- leaving the grant there is how the schema drifts back. Close it on the way in.
revoke all on function car_return_trigger() from public, anon, authenticated;
revoke all on function trade_doc_car_return_guard() from public, anon, authenticated;

-- The guard that refuses a car Purchase Return has to say where to go instead,
-- now that there is somewhere.
create or replace function trade_doc_car_return_guard()
returns trigger language plpgsql as $function$
begin
  if new.gl_entry is not null and old.gl_entry is null
     and new.doc_type = 'purchase_return'
     and upper(btrim(coalesce(new.cost_center, ''))) in ('CAR SALES INSTALLMENT', 'CAR TRADING') then
    raise exception 'A car Purchase Return cannot be posted: it cannot say which vehicles came back. To take a car back from a customer, raise a Sales Return and load the Car Invoice into it.';
  end if;
  return new;
end $function$;

-- ------------------------------------------------------------- the posting --
-- The vehicle pair, added to what a Sales Return already posts. Everything else
-- in this body is byte-for-byte what migration 281 left; only the block marked
-- CAR RETURN is new.

create or replace function trade_doc_post_now(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare d trade_documents; v_co uuid := auth_company_id(); ln record; is_stk boolean; prc numeric;
        v_stock numeric(18,2) := 0; v_other numeric(18,2) := 0; v_cogs_val numeric(18,2) := 0;
        v_party uuid; v_inv uuid; v_pur uuid; v_sr uuid; v_cogs uuid; v_ro uuid; v_veh uuid; v_sale uuid;
        lines jsonb := '[]'::jsonb; g jsonb; v_dr numeric(18,2); v_cr numeric(18,2); v_diff numeric(18,2); mv jsonb;
        v_upd_stock boolean; v_wh uuid; v_acct uuid; v_is_car boolean; v_car_cost numeric(18,2) := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.gl_entry is not null then raise exception 'Already posted'; end if;
  if d.doc_type not in ('purchase_voucher','purchase_return','sales_return','sales_invoice') then
    raise exception 'This document type does not post to the GL';
  end if;

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

-- --------------------------------------------------------------- the undo ----
-- Supersedes the body in migration 315: same routine, plus the one branch that
-- puts a returned car back on its contract.

create or replace function trade_doc_unpost(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  d          trade_documents;
  v_co       uuid := auth_company_id();
  mv         record;
  v_have     numeric(18,3);
  v_signed   numeric(18,2);
  v_entry_no text;
  v_moves    int := 0;
  v_vehicles int := 0;
  v_blocked  text;
  v_return   jsonb := jsonb_build_object('undone', false);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.gl_entry is null then
    return jsonb_build_object('unposted', false, 'reason', 'not posted');
  end if;
  if d.status = 'awaiting_approval' then
    raise exception 'This voucher is awaiting authorisation and cannot be changed.';
  end if;

  select string_agg(t.doc_no, ', ' order by t.doc_no) into v_blocked
  from trade_documents t
  where t.company_id = v_co and t.source_doc_id = d.id;
  if v_blocked is not null then
    raise exception '% has already been loaded into %. Delete or unpost that first.', d.doc_no, v_blocked;
  end if;

  select string_agg(v.vehicle_no, ', ' order by v.vehicle_no) into v_blocked
  from car_vehicles v
  where v.source_trade_doc = p_id
    and (v.contract_id is not null or v.status not in ('in_stock', 'ordered'));
  if v_blocked is not null then
    raise exception 'Vehicle % from % is sold or on a contract. Undo that first, then this purchase can be changed.', v_blocked, d.doc_no;
  end if;

  -- A car return: the car goes back to the customer and the invoice comes back
  -- to life BEFORE the ledger entry goes, so a refusal here changes nothing.
  -- It has to be refused if the car has since been sold on to somebody else —
  -- there is nothing to put back.
  if d.doc_type = 'sales_return' and d.source_car_contract is not null then
    select string_agg(v.vehicle_no, ', ') into v_blocked
    from car_contracts c join car_vehicles v on v.id = c.vehicle_id
    where c.id = d.source_car_contract and c.company_id = v_co
      and (v.contract_id is not null or v.status not in ('in_stock', 'held', 'reserved'));
    if v_blocked is not null then
      raise exception 'Vehicle % has been sold again since it came back on %. Undo that sale first.', v_blocked, d.doc_no;
    end if;
    v_return := car_return_undo(p_id);
  end if;

  delete from car_vehicles where source_trade_doc = p_id;
  get diagnostics v_vehicles = row_count;

  for mv in
    select * from stock_movements
    where company_id = v_co and reference = d.doc_no
    order by created_at desc
  loop
    v_signed := case when mv.qty < 0 then -mv.value else mv.value end;

    select qty into v_have from stock_balances
    where company_id = v_co and item_id = mv.item_id and warehouse_id = mv.warehouse_id
    for update;

    if coalesce(v_have, 0) - mv.qty < 0 then
      raise exception 'Cannot change %: only % of the % it received are still in stock — the rest has been issued.',
        d.doc_no, coalesce(v_have, 0), abs(mv.qty);
    end if;

    update stock_balances
       set qty = qty - mv.qty, value = value - v_signed
     where company_id = v_co and item_id = mv.item_id and warehouse_id = mv.warehouse_id;

    delete from stock_movements where id = mv.id;
    v_moves := v_moves + 1;
  end loop;

  select entry_no into v_entry_no from journal_entries where id = d.gl_entry;
  delete from journal_lines  where entry_id = d.gl_entry;
  delete from journal_entries where id = d.gl_entry and company_id = v_co;

  update trade_documents
     set gl_entry = null, posted_at = null, status = 'open', updated_at = now()
   where id = p_id;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'trade_doc_unpost', 'trade_document', p_id,
          jsonb_build_object('doc_no', d.doc_no, 'doc_type', d.doc_type,
                             'entry_no', v_entry_no, 'total', d.total,
                             'stock_movements_reversed', v_moves,
                             'vehicles_removed', v_vehicles,
                             'car_return_undone', v_return->'undone',
                             'reason', p_reason));

  return jsonb_build_object('unposted', true, 'entry_no', v_entry_no,
                            'stock_movements_reversed', v_moves,
                            'vehicles_removed', v_vehicles,
                            'car_return_undone', v_return->'undone');
end $function$;

revoke all on function trade_doc_unpost(uuid, text) from public, anon, authenticated;
