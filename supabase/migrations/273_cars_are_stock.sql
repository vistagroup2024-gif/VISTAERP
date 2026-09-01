-- 273_cars_are_stock.sql
-- Vehicles are stock. A purchased car lands in the Product Tree and carries a
-- quantity + value in Inventory like any other stock item; Car Sales then reads
-- that stock back, so a user with only Car Sales access can see how many cars
-- are on the yard without being given the Inventory module.
--
-- ONE unit of stock per vehicle record, driven by car_vehicles.status:
--   in_stock / reserved / held  -> on hand
--   ordered / sold / delivered / cancelled -> not on hand
-- The car module stays the system of record for the individual car; Inventory
-- holds the quantity and the value. Nothing here posts to the GL — the car
-- module's own accounting (1160 Vehicle Inventory / 5100 Cost of Vehicles Sold)
-- and trade_doc_post already cover that, and a third GL path would double-book.

-- Which product each vehicle counts as, and where its unit currently sits.
--   product_id       — the item it counts as today
--   stock_product_id — the item its unit is recorded against right now
--                      (null = the vehicle is not on hand)
--   source_product_id— the Purchase Voucher line's product, when it came from one
alter table car_vehicles add column if not exists product_id uuid references acct_products(id);
alter table car_vehicles add column if not exists stock_product_id uuid references acct_products(id);
alter table car_vehicles add column if not exists source_product_id uuid references acct_products(id);
alter table car_vehicles add column if not exists source_doc_line uuid;
create index if not exists idx_car_vehicles_product on car_vehicles(company_id, product_id);

-- ---------------------------------------------------------------------------
-- stock_apply: the moving-average balance maths, lifted out of stock_move so a
-- trigger can use it with the row's OWN company instead of the caller's session.
-- stock_move keeps its signature and becomes the authorised, GL-posting wrapper.
-- ---------------------------------------------------------------------------
create or replace function stock_apply(
  p_company uuid, p_type text, p_item uuid, p_wh uuid, p_qty numeric, p_rate numeric,
  p_date date, p_reference text, p_narration text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare bal stock_balances%rowtype; v_no text; v_value numeric(18,2);
        v_signed numeric(18,3); v_avg numeric(18,4); v_entry uuid;
begin
  if coalesce(p_qty,0) <= 0 then raise exception 'Quantity must be positive'; end if;

  select * into bal from stock_balances
    where company_id = p_company and item_id = p_item and warehouse_id = p_wh for update;
  if not found then
    insert into stock_balances(company_id, item_id, warehouse_id, qty, value)
      values (p_company, p_item, p_wh, 0, 0) returning * into bal;
  end if;

  if p_type = 'issue' then
    if p_qty > bal.qty then raise exception 'Insufficient stock: have %, need %', bal.qty, p_qty; end if;
    v_avg := case when bal.qty > 0 then bal.value / bal.qty else 0 end;
    v_value := round(p_qty * v_avg, 2);
    v_signed := -p_qty;
    update stock_balances set qty = qty - p_qty, value = value - v_value where id = bal.id;
    p_rate := round(v_avg, 2);
  else -- receipt or adjust (positive add)
    v_value := round(p_qty * coalesce(p_rate,0), 2);
    v_signed := p_qty;
    update stock_balances set qty = qty + p_qty, value = value + v_value where id = bal.id;
  end if;

  insert into doc_sequences(company_id, doc_type, prefix)
    values (p_company, 'stock_'||p_type, upper(left(p_type,3))||'-') on conflict (company_id, doc_type) do nothing;
  v_no := next_doc_number(p_company, 'stock_'||p_type);

  insert into stock_movements(company_id, doc_type, doc_no, doc_date, item_id, warehouse_id,
                              qty, rate, value, reference, narration, created_by)
    values (p_company, p_type, v_no, coalesce(p_date, current_date), p_item, p_wh,
            v_signed, coalesce(p_rate,0), v_value, p_reference, p_narration, auth.uid())
    returning id into v_entry;

  return jsonb_build_object('id', v_entry, 'doc_no', v_no, 'value', v_value, 'rate', p_rate);
end $$;

-- stock_move: authorise, apply, then post the GL. Behaviour is unchanged.
create or replace function stock_move(
  p_type text, p_item uuid, p_wh uuid, p_qty numeric, p_rate numeric, p_date date,
  p_reference text, p_narration text, p_post_gl boolean, p_counter uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); r jsonb; v_value numeric(18,2);
        v_inv uuid; v_cogs uuid; g jsonb; lines jsonb; v_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  r := stock_apply(v_co, p_type, p_item, p_wh, p_qty, p_rate, p_date, p_reference, p_narration);
  v_value := (r->>'value')::numeric;
  v_no := r->>'doc_no';

  if coalesce(p_post_gl, false) and v_value > 0 then
    v_inv := acct_ensure_named(v_co, 'Inventory', 'asset', '1', 'Current Asset');
    if p_type = 'issue' then
      v_cogs := acct_ensure_named(v_co, 'Cost of Goods Sold', 'expense', '5', 'COGS');
      lines := jsonb_build_array(
        jsonb_build_object('account_id', v_cogs::text, 'debit', v_value, 'credit', 0, 'description', 'Stock issue '||v_no),
        jsonb_build_object('account_id', v_inv::text, 'debit', 0, 'credit', v_value, 'description', 'Stock issue '||v_no));
      g := gl_post(v_co, coalesce(p_date, current_date), 'Stock issue '||v_no, 'gl_stock_out', v_no, lines);
    elsif p_counter is not null then
      lines := jsonb_build_array(
        jsonb_build_object('account_id', v_inv::text, 'debit', v_value, 'credit', 0, 'description', 'Stock receipt '||v_no),
        jsonb_build_object('account_id', p_counter::text, 'debit', 0, 'credit', v_value, 'description', 'Stock receipt '||v_no));
      g := gl_post(v_co, coalesce(p_date, current_date), 'Stock receipt '||v_no, 'gl_stock_in', v_no, lines);
    end if;
    if g is not null then update stock_movements set gl_entry = (g->>'entry_id')::uuid where id = (r->>'id')::uuid; end if;
  end if;

  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Where the cars sit. One yard warehouse, created on first use.
-- ---------------------------------------------------------------------------
create or replace function car_stock_warehouse(p_company uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from warehouses
    where company_id = p_company and upper(btrim(name)) = 'CAR YARD' limit 1;
  if v_id is null then
    insert into warehouses(company_id, name) values (p_company, 'CAR YARD') returning id into v_id;
  end if;
  return v_id;
end $$;

-- A product group, created under the root if it is not there yet.
create or replace function car_product_group(p_company uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from acct_products
    where company_id = p_company and is_group and upper(btrim(name)) = upper(btrim(p_name)) limit 1;
  if v_id is null then
    insert into acct_products(company_id, parent_id, name, is_group, is_active)
      values (p_company, null, upper(btrim(p_name)), true, true) returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- The stock item a vehicle counts as.
--   * bought on a Purchase Voucher -> the item that voucher line named
--   * otherwise -> derived from the specification, e.g.
--       "HYNDAI STAREX 2021 SILVER (FULL)"
-- Either way the item is flagged as stock, measured in NOS, and filed under
-- TRADING VEHICLES or VEHICLES to match the car's own classification.
-- ---------------------------------------------------------------------------
create or replace function car_vehicle_product(p_vehicle uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v car_vehicles; v_grp uuid; v_name text; v_id uuid;
begin
  select * into v from car_vehicles where id = p_vehicle;
  if not found then return null; end if;

  v_grp := car_product_group(v.company_id, case when v.is_trading then 'TRADING VEHICLES' else 'VEHICLES' end);

  -- The voucher's own item wins: the buyer already named the car there.
  if v.source_product_id is not null then
    update acct_products
      set is_stock = true, uom = coalesce(nullif(btrim(uom), ''), 'NOS'),
          parent_id = coalesce(parent_id, v_grp)
      where id = v.source_product_id;
    return v.source_product_id;
  end if;

  v_name := upper(btrim(concat_ws(' ',
    nullif(btrim(coalesce(v.make, '')), ''),
    nullif(btrim(coalesce(v.model, '')), ''),
    nullif(v.model_year::text, ''),
    nullif(btrim(coalesce(v.color, '')), ''))));
  if nullif(btrim(coalesce(v.variant, '')), '') is not null then
    v_name := btrim(v_name || ' (' || upper(btrim(v.variant)) || ')');
  end if;
  -- Nothing filled in yet (a voucher-created car before its details are typed):
  -- park it under its own number so the yard count is still right.
  if v_name = '' then v_name := v.vehicle_no; end if;

  select id into v_id from acct_products
    where company_id = v.company_id and not is_group and upper(btrim(name)) = v_name limit 1;
  if v_id is null then
    insert into acct_products(company_id, parent_id, name, is_group, is_active, is_stock, uom, purchase_rate)
      values (v.company_id, v_grp, v_name, false, true, true, 'NOS', coalesce(v.total_cost, v.purchase_cost, 0))
      returning id into v_id;
  else
    update acct_products
      set is_stock = true, uom = coalesce(nullif(btrim(uom), ''), 'NOS'), parent_id = coalesce(parent_id, v_grp)
      where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Bring one vehicle's stock in line with its status. Idempotent: it compares
-- where the unit IS (stock_product_id) with where it BELONGS and moves only the
-- difference, so re-running it changes nothing.
-- ---------------------------------------------------------------------------
create or replace function car_vehicle_stock_sync(p_vehicle uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v car_vehicles; v_want uuid; v_on_hand boolean; v_wh uuid; v_cost numeric;
begin
  select * into v from car_vehicles where id = p_vehicle;
  if not found then return; end if;

  v_want := car_vehicle_product(p_vehicle);
  if v_want is null then return; end if;
  v_on_hand := v.status in ('in_stock', 'reserved', 'held');
  v_wh := car_stock_warehouse(v.company_id);
  v_cost := coalesce(nullif(v.total_cost, 0), v.purchase_cost, 0);

  -- Off the shelf: sold, delivered, cancelled, or now counted as another item.
  if v.stock_product_id is not null and (not v_on_hand or v.stock_product_id <> v_want) then
    perform stock_apply(v.company_id, 'issue', v.stock_product_id, v_wh, 1, 0,
      coalesce(v.updated_at::date, current_date), v.vehicle_no,
      'Vehicle ' || v.vehicle_no || ' — ' || v.status);
    update car_vehicles set stock_product_id = null where id = p_vehicle;
    v.stock_product_id := null;
  end if;

  -- On the shelf and not yet counted.
  if v_on_hand and v.stock_product_id is null then
    perform stock_apply(v.company_id, 'receipt', v_want, v_wh, 1, v_cost,
      coalesce(v.purchase_date, current_date), v.vehicle_no,
      'Vehicle ' || v.vehicle_no || ' received');
    update car_vehicles set stock_product_id = v_want where id = p_vehicle;
  end if;

  update car_vehicles set product_id = v_want where id = p_vehicle;
end $$;

-- Fire on every insert and on the changes that can move a car in or out of
-- stock. Never blocks the car module: a stock failure is logged, not raised.
create or replace function car_vehicle_stock_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text; v_state text; v_ctx text;
begin
  begin
    perform car_vehicle_stock_sync(new.id);
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
    raise warning 'car_vehicle_stock_sync(%) failed [%]: % / %', new.id, v_state, v_err, v_ctx;
    begin
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (new.company_id, auth.uid(), 'car_stock_sync_failed', 'car_vehicle', new.id,
              jsonb_build_object('sqlstate', v_state, 'message', v_err, 'context', v_ctx));
    exception when others then null; end;
  end;
  return null;
end $$;

drop trigger if exists trg_car_vehicle_stock on car_vehicles;
create trigger trg_car_vehicle_stock after insert or update of
  status, make, model, model_year, color, variant, is_trading, purchase_cost, purchase_vat, source_product_id
  on car_vehicles for each row execute function car_vehicle_stock_trigger();

-- ---------------------------------------------------------------------------
-- A posted car Purchase Voucher now creates ONE vehicle per unit bought, each
-- linked to the item its line named and carrying its share of the voucher
-- total, so the yard count and the stock quantity always agree.
-- ---------------------------------------------------------------------------
create or replace function car_vehicle_from_trade_doc(p_doc uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d trade_documents; v_cc text; v_id uuid; v_first uuid; v_no text;
        ln record; v_units int; v_have int; v_share numeric; v_unit numeric;
        v_lines_qty numeric; v_lines_amt numeric;
begin
  select * into d from trade_documents where id = p_doc;
  if not found then return null; end if;
  if d.doc_type <> 'purchase_voucher' then return null; end if;
  v_cc := upper(btrim(coalesce(d.cost_center, '')));
  if v_cc not in ('CAR SALES INSTALLMENT', 'CAR TRADING') then return null; end if;

  -- Totals across the car lines, used to split the voucher total between them.
  select coalesce(sum(greatest(round(coalesce(l.quantity, 1)), 1)), 0),
         coalesce(sum(coalesce(l.amount, 0)), 0)
    into v_lines_qty, v_lines_amt
    from trade_document_lines l where l.doc_id = p_doc;

  if v_lines_qty = 0 then
    -- A voucher with no lines still buys a car: keep the old one-per-voucher
    -- behaviour rather than dropping it on the floor.
    select id into v_id from car_vehicles where source_trade_doc = p_doc limit 1;
    if v_id is not null then return v_id; end if;
    v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
    -- total_cost is generated (purchase_cost + purchase_vat) — never inserted.
    insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
      ownership, is_trading, status, notes, source_trade_doc)
    values (d.company_id, v_no, d.party_id, d.doc_date, coalesce(d.total, 0),
      'vista', v_cc = 'CAR TRADING', 'in_stock',
      'Created from Purchase Voucher ' || coalesce(d.doc_no, ''), p_doc)
    returning id into v_id;
    return v_id;
  end if;

  for ln in select l.id, l.product_id, l.item_name, l.quantity, l.amount
            from trade_document_lines l where l.doc_id = p_doc order by l.sort loop
    v_units := greatest(round(coalesce(ln.quantity, 1))::int, 1);
    -- The voucher total carries the landed cost, so split THAT between the
    -- lines — by what each line is worth, not by how many units it holds, or a
    -- cheap car and an expensive one on the same voucher would cost the same.
    if v_lines_amt > 0 then
      v_share := coalesce(d.total, 0) * (coalesce(ln.amount, 0) / v_lines_amt);
    else
      v_share := coalesce(d.total, 0) * (v_units::numeric / v_lines_qty);
    end if;
    v_unit := round(v_share / v_units, 2);

    select count(*) into v_have from car_vehicles where source_doc_line = ln.id;
    while v_have < v_units loop
      v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
      insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
        ownership, is_trading, status, notes, source_trade_doc, source_doc_line, source_product_id)
      values (d.company_id, v_no, d.party_id, d.doc_date, v_unit,
        'vista', v_cc = 'CAR TRADING', 'in_stock',
        'Created from Purchase Voucher ' || coalesce(d.doc_no, ''), p_doc, ln.id, ln.product_id)
      returning id into v_id;
      if v_first is null then v_first := v_id; end if;
      v_have := v_have + 1;
    end loop;
  end loop;

  if v_first is null then select id into v_first from car_vehicles where source_trade_doc = p_doc limit 1; end if;
  return v_first;
end $$;

-- ---------------------------------------------------------------------------
-- Car Sales stock, for a user who has Car Sales and nothing else: what is on
-- the yard, by item, straight from the same Inventory balances.
-- ---------------------------------------------------------------------------
create or replace function car_stock_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select distinct v.product_id from car_vehicles v
    where v.company_id = auth_company_id() and v.product_id is not null
  ),
  bal as (
    select b.item_id, sum(b.qty) qty, sum(b.value) value
    from stock_balances b
    where b.company_id = auth_company_id() and b.item_id in (select product_id from mine)
    group by b.item_id
  )
  select jsonb_build_object(
    'total_qty', coalesce((select sum(qty) from bal), 0),
    'total_value', coalesce((select sum(value) from bal), 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'item', pr.name, 'uom', pr.uom,
        'group', (select g.name from acct_products g where g.id = pr.parent_id),
        'qty', b.qty, 'value', b.value,
        'avg_cost', case when b.qty <> 0 then round(b.value / b.qty, 2) else 0 end)
        order by pr.name)
      from bal b join acct_products pr on pr.id = b.item_id
      where b.qty <> 0 or b.value <> 0), '[]'::jsonb));
$$;

grant execute on function stock_apply(uuid, text, uuid, uuid, numeric, numeric, date, text, text) to authenticated;
grant execute on function car_stock_warehouse(uuid) to authenticated;
grant execute on function car_product_group(uuid, text) to authenticated;
grant execute on function car_vehicle_product(uuid) to authenticated;
grant execute on function car_vehicle_stock_sync(uuid) to authenticated;
grant execute on function car_stock_summary() to authenticated;

-- Give every existing vehicle its item in the Product Tree, and put the ones
-- still on the yard into stock. Vehicles already sold stay at zero — the count
-- is what is on hand today, not a rebuild of history.
do $$
declare v record;
begin
  for v in select id from car_vehicles order by created_at loop
    begin perform car_vehicle_stock_sync(v.id); exception when others then
      raise warning 'backfill car_vehicle_stock_sync(%) failed: %', v.id, sqlerrm; end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- trade_doc_post: on a CAR cost centre the vehicle records own the quantity —
-- one unit per car, in and out with the car's status — so the line loop must
-- not also receive it or the yard would be counted twice. The GL side is
-- untouched: car lines classify exactly as they do today.
-- ---------------------------------------------------------------------------
create or replace function trade_doc_post(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d trade_documents; v_co uuid := auth_company_id(); ln record; is_stk boolean; prc numeric;
        v_stock numeric(18,2) := 0; v_other numeric(18,2) := 0; v_cogs_val numeric(18,2) := 0;
        v_party uuid; v_inv uuid; v_pur uuid; v_sr uuid; v_cogs uuid; v_ro uuid;
        lines jsonb := '[]'::jsonb; g jsonb; v_dr numeric(18,2); v_cr numeric(18,2); v_diff numeric(18,2); mv jsonb;
        v_upd_stock boolean; v_wh uuid; v_acct uuid; v_is_car boolean;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.gl_entry is not null then raise exception 'Already posted'; end if;
  if d.doc_type not in ('purchase_voucher','purchase_return','sales_return') then
    raise exception 'This document type does not post to the GL';
  end if;

  -- Update Stocks: absent means true (documents predating this option).
  v_upd_stock := coalesce((d.meta->>'update_stock')::boolean, true);
  -- Cars are stocked one unit per vehicle record, by car_vehicle_stock_sync.
  v_is_car := upper(btrim(coalesce(d.cost_center, ''))) in ('CAR SALES INSTALLMENT', 'CAR TRADING');
  -- Warehouse is no longer asked for on the form; fall back to the company's own.
  v_wh := d.warehouse_id;
  if v_upd_stock and v_wh is null then
    select id into v_wh from warehouses where company_id = v_co and coalesce(is_active, true) order by created_at limit 1;
  end if;

  -- Stock movements per line (balances only; one combined GL entry below).
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
      elsif d.doc_type = 'sales_return' then
        prc := coalesce(nullif(ln.purchase_rate,0), 0);
        if prc > 0 then
          perform stock_move('receipt', ln.product_id, v_wh, ln.quantity, prc, d.doc_date, d.doc_no, 'Sales return '||d.doc_no, false, null);
          v_cogs_val := v_cogs_val + round(ln.quantity * prc, 2);
        end if;
      end if;
    else
      v_other := v_other + ln.amount;
    end if;
  end loop;

  v_inv := acct_ensure_named(v_co, 'Inventory', 'asset', '1', 'Current Asset');
  v_ro  := acct_ensure_named(v_co, 'Round Off', 'expense', '5', 'Indirect Expense');

  if d.doc_type = 'purchase_voucher' or d.doc_type = 'purchase_return' then
    v_party := ensure_party_account(v_co, d.party_id, 'supplier');
    -- Purchase Account chosen on the voucher wins; must be a postable account of
    -- this company, otherwise fall back to the auto-named 'Purchases'.
    select id into v_acct from accounts
      where id = nullif(d.meta->>'purchase_account','')::uuid and company_id = v_co and is_postable;
    v_pur := coalesce(v_acct, acct_ensure_named(v_co, 'Purchases', 'expense', '5', 'COGS'));
    if d.doc_type = 'purchase_voucher' then
      if v_stock > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_inv::text, 'debit', v_stock, 'credit', 0, 'description', 'Stock '||d.doc_no)); end if;
      if v_other > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_pur::text, 'debit', v_other, 'credit', 0, 'description', 'Purchase '||d.doc_no)); end if;
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_party::text, 'debit', 0, 'credit', d.total, 'description', coalesce(d.narration, d.doc_no), 'cost_center', d.cost_center, 'tag_area', d.tag_area));
    else -- purchase_return
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_party::text, 'debit', d.total, 'credit', 0, 'description', coalesce(d.narration, d.doc_no), 'cost_center', d.cost_center, 'tag_area', d.tag_area));
      if v_stock > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_inv::text, 'debit', 0, 'credit', v_stock, 'description', 'Stock '||d.doc_no)); end if;
      if v_other > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_pur::text, 'debit', 0, 'credit', v_other, 'description', 'Purchase '||d.doc_no)); end if;
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
  end if;

  -- Universal balancer: any price/cost or round-off difference → Round Off.
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
end $$;

grant execute on function trade_doc_post(uuid) to authenticated;
