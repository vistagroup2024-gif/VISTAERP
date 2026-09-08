-- ROLLBACK for 318_car_return.sql.
--
-- Takes the Sales Return ← Car Invoice route away: a Car Invoice stops showing
-- in the Sales Return's Load list, a Sales Return stops posting the vehicle
-- pair, and posting one stops touching the vehicle or the invoice.
--
-- READ THIS BEFORE RUNNING IT. Returns already posted are NOT undone — their
-- ledger entries stand, their cars stay in stock and their Car Invoices stay
-- cancelled, which is correct, because those returns really happened. What the
-- rollback removes is the ability to raise a NEW one, and the undo that
-- trade_doc_unpost performed. So check first:
--
--     select doc_no, doc_date, total from trade_documents
--      where doc_type = 'sales_return' and source_car_contract is not null;
--
-- An empty result means this is a clean reversal. Otherwise, delete or unpost
-- those returns FIRST — while 318 is still in place, so the vehicle and the
-- invoice come back with them — and only then roll back.
--
-- The four columns are not dropped, on purpose: returned_at on a vehicle is the
-- only record that the car came back. Drop them by hand once nothing needs them:
--     alter table car_vehicles  drop column returned_at, drop column returned_from_contract;
--     alter table car_contracts drop column returned_at, drop column returned_doc_id;

-- ------------------------------------------------------------- the trigger --

drop trigger if exists trg_car_return on trade_documents;
drop function if exists car_return_trigger();

-- The guard goes back to naming no alternative, because there is none again.
create or replace function trade_doc_car_return_guard()
returns trigger language plpgsql as $function$
begin
  if new.gl_entry is not null and old.gl_entry is null
     and new.doc_type = 'purchase_return'
     and upper(btrim(coalesce(new.cost_center, ''))) in ('CAR SALES INSTALLMENT', 'CAR TRADING') then
    raise exception 'A car Purchase Return cannot be posted: it cannot say which vehicles came back. Cancel or delete the vehicle records instead.';
  end if;
  return new;
end $function$;

-- ------------------------------------------------------------- the picker ----

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
    select c.id, c.contract_no, c.contract_date,
           (select p.name from parties p where p.id = c.customer_id),
           'CAR SALES', null, c.sale_price, 1, 'car'
    from car_contracts c
    where p_target_type = 'delivery_note'
      and c.company_id = auth_company_id()
      and c.status in ('active', 'completed')
      and not exists (
        select 1 from trade_documents t
        where t.company_id = c.company_id and t.doc_type = 'delivery_note' and t.source_car_contract = c.id)
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

-- --------------------------------------------------------------- the load ----

create or replace function trade_doc_load(p_source uuid, p_target_type text)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare d trade_documents; c car_contracts; v_src text; v_co uuid := auth_company_id(); v_item text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  if p_target_type = 'delivery_note' then
    select * into c from car_contracts where id = p_source and company_id = v_co;
    if found then
      if exists (select 1 from trade_documents t where t.company_id = v_co
                 and t.doc_type = 'delivery_note' and t.source_car_contract = p_source) then
        raise exception 'Car Invoice % has already been delivered.', c.contract_no;
      end if;
      select coalesce(p.name, concat_ws(' ', v.make, v.model, v.model_year::text, v.color), v.vehicle_no)
        into v_item
        from car_vehicles v left join acct_products p on p.id = v.product_id
        where v.id = c.vehicle_id;
      return jsonb_build_object(
        'id', c.id, 'doc_type', 'car_invoice', 'doc_no', c.contract_no, 'doc_date', c.contract_date,
        'party_id', c.customer_id, 'cost_center', 'CAR SALES', 'tag_area', null,
        'reference', c.contract_no, 'narration', c.notes, 'terms', null, 'mode_of_payment', null,
        'due_date', null, 'delivery_date', c.delivery_date, 'total', c.sale_price,
        'meta', '{}'::jsonb, 'source_kind', 'car',
        'lines', jsonb_build_array(jsonb_build_object(
          'product_id', (select v.product_id from car_vehicles v where v.id = c.vehicle_id),
          'item_name', coalesce(v_item, 'Vehicle'), 'units', 'NOS',
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

-- ------------------------------------------------------------ the posting ----
-- Back to the body migration 281 left: no vehicle pair on a Sales Return.

create or replace function trade_doc_post_now(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare d trade_documents; v_co uuid := auth_company_id(); ln record; is_stk boolean; prc numeric;
        v_stock numeric(18,2) := 0; v_other numeric(18,2) := 0; v_cogs_val numeric(18,2) := 0;
        v_party uuid; v_inv uuid; v_pur uuid; v_sr uuid; v_cogs uuid; v_ro uuid; v_veh uuid; v_sale uuid;
        lines jsonb := '[]'::jsonb; g jsonb; v_dr numeric(18,2); v_cr numeric(18,2); v_diff numeric(18,2); mv jsonb;
        v_upd_stock boolean; v_wh uuid; v_acct uuid; v_is_car boolean;
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

  else
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

-- ---------------------------------------------------------------- the undo ----
-- Back to the body migration 315 left: no car-return branch.

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
                             'reason', p_reason));

  return jsonb_build_object('unposted', true, 'entry_no', v_entry_no,
                            'stock_movements_reversed', v_moves,
                            'vehicles_removed', v_vehicles);
end $function$;

revoke all on function trade_doc_unpost(uuid, text) from public, anon, authenticated;

drop function if exists car_return_apply(uuid);
drop function if exists car_return_undo(uuid);
