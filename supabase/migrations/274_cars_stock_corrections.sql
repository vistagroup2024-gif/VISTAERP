-- 274_cars_stock_corrections.sql
-- Four corrections to 273.
--
--  1. The Product Tree is master data. Nothing creates or edits items behind the
--     user's back — a vehicle simply POINTS AT the item its voucher line chose.
--  2. A car bought on a Purchase Voucher is posted once. The voucher debits
--     1160 Vehicle Inventory (the account the car module's sale entry credits),
--     and the car module no longer re-posts the purchase for that vehicle.
--  3. Car accounting posts itself. Each car event posts its own journal as it
--     happens, so there is no "Sync to Accounting" button to remember.
--  4. What Car Sales shows is grouped by the ITEM the voucher named — buy 2
--     black Staria, 2 white Staria and 1 black Starex on one voucher and Car
--     Sales shows 2 / 2 / 1, with no name typed anywhere by hand.

-- ---------------------------------------------------------------------------
-- 1. The item a vehicle counts as: the one its voucher line named, or the one
--    chosen on the vehicle itself. Never invented, never modified.
-- ---------------------------------------------------------------------------
drop function if exists car_product_group(uuid, text);

create or replace function car_vehicle_product(p_vehicle uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(v.source_product_id, v.product_id) from car_vehicles v where v.id = p_vehicle;
$$;

-- A vehicle with no item is simply not counted: nothing to invent a name from.
create or replace function car_vehicle_stock_sync(p_vehicle uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v car_vehicles; v_want uuid; v_on_hand boolean; v_wh uuid; v_cost numeric;
begin
  select * into v from car_vehicles where id = p_vehicle;
  if not found then return; end if;

  v_want := car_vehicle_product(p_vehicle);
  v_on_hand := v.status in ('in_stock', 'reserved', 'held') and v_want is not null;
  v_cost := coalesce(nullif(v.total_cost, 0), v.purchase_cost, 0);

  -- Off the shelf: sold, delivered, cancelled, no item any more, or now counted
  -- as a different item.
  if v.stock_product_id is not null and (not v_on_hand or v.stock_product_id <> v_want) then
    v_wh := car_stock_warehouse(v.company_id);
    perform stock_apply(v.company_id, 'issue', v.stock_product_id, v_wh, 1, 0,
      coalesce(v.updated_at::date, current_date), v.vehicle_no,
      'Vehicle ' || v.vehicle_no || ' — ' || v.status);
    update car_vehicles set stock_product_id = null where id = p_vehicle;
    v.stock_product_id := null;
  end if;

  -- On the shelf and not yet counted.
  if v_on_hand and v.stock_product_id is null then
    v_wh := car_stock_warehouse(v.company_id);
    perform stock_apply(v.company_id, 'receipt', v_want, v_wh, 1, v_cost,
      coalesce(v.purchase_date, current_date), v.vehicle_no,
      'Vehicle ' || v.vehicle_no || ' received');
    update car_vehicles set stock_product_id = v_want where id = p_vehicle;
  end if;

  if v.product_id is distinct from v_want then
    update car_vehicles set product_id = v_want where id = p_vehicle;
  end if;
end $$;

-- The item can also be chosen on the vehicle itself, for a car that never came
-- through a voucher. It is picked from the Product Tree, never typed.
create or replace function public.car_vehicle_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_id uuid; v_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then
    v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
    insert into car_vehicles(company_id, vehicle_no, created_by) values (v_company, v_no, auth.uid())
      returning id into v_id;
  else
    v_id := p_id;
  end if;

  update car_vehicles set
    product_id    = nullif(p->>'product_id','')::uuid,
    vin           = nullif(p->>'vin',''),
    plate_no      = nullif(p->>'plate_no',''),
    make          = nullif(p->>'make',''),
    model         = nullif(p->>'model',''),
    variant       = nullif(p->>'variant',''),
    model_year    = nullif(p->>'model_year','')::int,
    color         = nullif(p->>'color',''),
    engine_no     = nullif(p->>'engine_no',''),
    purchase_date = nullif(p->>'purchase_date','')::date,
    supplier_id   = nullif(p->>'supplier_id','')::uuid,
    purchase_cost = coalesce(nullif(p->>'purchase_cost','')::numeric, 0),
    purchase_vat  = coalesce(nullif(p->>'purchase_vat','')::numeric, 0),
    current_location = nullif(p->>'current_location',''),
    status        = coalesce(nullif(p->>'status','')::car_vehicle_status, status),
    ownership     = coalesce(nullif(p->>'ownership','')::car_ownership_status, ownership),
    notes         = nullif(p->>'notes',''),
    updated_at    = now()
  where id = v_id and company_id = v_company;

  return v_id;
end $$;
revoke all on function public.car_vehicle_save(uuid, jsonb) from anon;
grant execute on function public.car_vehicle_save(uuid, jsonb) to authenticated;

-- product_id is now user-settable, so a change to it must resync the stock.
drop trigger if exists trg_car_vehicle_stock on car_vehicles;
create trigger trg_car_vehicle_stock after insert or update of
  status, is_trading, purchase_cost, purchase_vat, product_id, source_product_id
  on car_vehicles for each row execute function car_vehicle_stock_trigger();

-- ---------------------------------------------------------------------------
-- 3. Car accounting posts itself: one journal per event, as the event happens.
--    Every one of these is idempotent — car_post_entry skips a (source,
--    reference) it has already posted — so a retry or a catch-up costs nothing.
-- ---------------------------------------------------------------------------
create or replace function car_post_vehicle(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v car_vehicles;
begin
  select * into v from car_vehicles where id = p_id;
  if not found or coalesce(v.total_cost, 0) <= 0 or v.status = 'cancelled' then return false; end if;
  -- Bought on a Purchase Voucher? That voucher already debited 1160 and
  -- credited the supplier. Posting it again here would double the purchase.
  if v.source_trade_doc is not null then return false; end if;
  perform car_ensure_accounts(v.company_id);
  return car_post_entry(v.company_id, v.purchase_date, 'Vehicle purchase ' || v.vehicle_no,
    'car_purchase', v.vehicle_no,
    jsonb_build_array(jsonb_build_object('code','1160','debit',v.total_cost),
                      jsonb_build_object('code','2100','credit',v.total_cost)));
end $$;

create or replace function car_post_contract(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare c car_contracts; n boolean := false;
begin
  select * into c from car_contracts where id = p_id;
  if not found or c.status not in ('active','completed') then return false; end if;
  perform car_ensure_accounts(c.company_id);
  n := car_post_entry(c.company_id, c.contract_date, 'Vehicle sale ' || c.contract_no, 'car_sale', c.contract_no,
    jsonb_build_array(
      jsonb_build_object('code','1150','debit',c.sale_price),
      jsonb_build_object('code','4200','credit',c.sale_price),
      jsonb_build_object('code','5100','debit',c.purchase_cost),
      jsonb_build_object('code','1160','credit',c.purchase_cost)));
  if coalesce(c.advance,0) > 0 then
    n := car_post_entry(c.company_id, c.contract_date, 'Advance ' || c.contract_no, 'car_advance', c.contract_no,
      jsonb_build_array(jsonb_build_object('code','1000','debit',c.advance),
                        jsonb_build_object('code','1150','credit',c.advance))) or n;
  end if;
  return n;
end $$;

create or replace function car_post_receipt(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r car_receipts;
begin
  select * into r from car_receipts where id = p_id;
  if not found then return false; end if;
  perform car_ensure_accounts(r.company_id);
  return car_post_entry(r.company_id, r.receipt_date, 'Installment receipt ' || r.receipt_no,
    'car_receipt', r.receipt_no,
    jsonb_build_array(jsonb_build_object('code', case when r.method = 'cash' then '1000' else '1010' end, 'debit', r.amount),
                      jsonb_build_object('code','1150','credit', r.amount)));
end $$;

create or replace function car_post_charge(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare c car_service_charges;
begin
  select * into c from car_service_charges where id = p_id;
  if not found then return false; end if;
  perform car_ensure_accounts(c.company_id);
  return car_post_entry(c.company_id, c.charge_month, 'Monthly service charge', 'car_scharge', c.id::text,
    jsonb_build_array(jsonb_build_object('code','1170','debit',c.amount),
                      jsonb_build_object('code','4300','credit',c.amount)));
end $$;

create or replace function car_post_charge_payment(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p car_service_charge_payments; v_co uuid;
begin
  select * into p from car_service_charge_payments where id = p_id;
  if not found then return false; end if;
  select c.company_id into v_co from car_service_charges c where c.id = p.charge_id;
  if v_co is null then return false; end if;
  perform car_ensure_accounts(v_co);
  return car_post_entry(v_co, p.pay_date, 'Service charge payment', 'car_scharge_pay', p.id::text,
    jsonb_build_array(jsonb_build_object('code', case when p.method = 'cash' then '1000' else '1010' end, 'debit', p.amount),
                      jsonb_build_object('code','1170','credit', p.amount)));
end $$;

create or replace function car_post_commission(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare cm car_commissions; v_no text;
begin
  select * into cm from car_commissions where id = p_id;
  if not found or coalesce(cm.amount,0) <= 0 then return false; end if;
  select contract_no into v_no from car_contracts where id = cm.contract_id;
  if v_no is null then return false; end if;
  perform car_ensure_accounts(cm.company_id);
  return car_post_entry(cm.company_id, current_date, 'Commission ' || v_no, 'car_commission', v_no,
    jsonb_build_array(jsonb_build_object('code','6300','debit',cm.amount),
                      jsonb_build_object('code','2110','credit',cm.amount)));
end $$;

-- One trigger body for all of them: post this row, and never let an accounting
-- problem block the car operation that caused it — log it instead.
create or replace function car_autopost_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text; v_state text; v_ctx text;
begin
  begin
    case tg_argv[0]
      when 'vehicle'        then perform car_post_vehicle(new.id);
      when 'contract'       then perform car_post_contract(new.id);
      when 'receipt'        then perform car_post_receipt(new.id);
      when 'charge'         then perform car_post_charge(new.id);
      when 'charge_payment' then perform car_post_charge_payment(new.id);
      when 'commission'     then perform car_post_commission(new.id);
      else null;
    end case;
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
    raise warning 'car autopost (%) failed for % [%]: % / %', tg_argv[0], new.id, v_state, v_err, v_ctx;
    begin
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (auth_company_id(), auth.uid(), 'car_autopost_failed', tg_argv[0]::text, new.id,
              jsonb_build_object('sqlstate', v_state, 'message', v_err, 'context', v_ctx));
    exception when others then null; end;
  end;
  return null;
end $$;

drop trigger if exists trg_car_autopost_vehicle on car_vehicles;
create trigger trg_car_autopost_vehicle after insert or update of status, purchase_cost, purchase_vat
  on car_vehicles for each row execute function car_autopost_trigger('vehicle');

drop trigger if exists trg_car_autopost_contract on car_contracts;
create trigger trg_car_autopost_contract after insert or update of status, sale_price, advance, purchase_cost
  on car_contracts for each row execute function car_autopost_trigger('contract');

drop trigger if exists trg_car_autopost_receipt on car_receipts;
create trigger trg_car_autopost_receipt after insert on car_receipts
  for each row execute function car_autopost_trigger('receipt');

drop trigger if exists trg_car_autopost_charge on car_service_charges;
create trigger trg_car_autopost_charge after insert on car_service_charges
  for each row execute function car_autopost_trigger('charge');

drop trigger if exists trg_car_autopost_charge_payment on car_service_charge_payments;
create trigger trg_car_autopost_charge_payment after insert on car_service_charge_payments
  for each row execute function car_autopost_trigger('charge_payment');

drop trigger if exists trg_car_autopost_commission on car_commissions;
create trigger trg_car_autopost_commission after insert on car_commissions
  for each row execute function car_autopost_trigger('commission');

-- Catch-up pass over one company, for anything that predates the triggers.
-- Same entries, same idempotency — it just walks everything instead of one row.
create or replace function car_accounting_sync_company(p_company uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  perform car_ensure_accounts(p_company);
  for r in select id from car_vehicles where company_id = p_company loop
    if car_post_vehicle(r.id) then n := n + 1; end if; end loop;
  for r in select id from car_contracts where company_id = p_company loop
    if car_post_contract(r.id) then n := n + 1; end if; end loop;
  for r in select id from car_receipts where company_id = p_company loop
    if car_post_receipt(r.id) then n := n + 1; end if; end loop;
  for r in select id from car_service_charges where company_id = p_company loop
    if car_post_charge(r.id) then n := n + 1; end if; end loop;
  for r in select p.id from car_service_charge_payments p
           join car_service_charges c on c.id = p.charge_id where c.company_id = p_company loop
    if car_post_charge_payment(r.id) then n := n + 1; end if; end loop;
  for r in select id from car_commissions where company_id = p_company loop
    if car_post_commission(r.id) then n := n + 1; end if; end loop;
  return n;
end $$;

create or replace function public.car_accounting_sync()
returns int language plpgsql security definer set search_path = public as $$
declare v_company uuid := auth_company_id(); n int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  n := car_accounting_sync_company(v_company);
  if n > 0 then
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (v_company, auth.uid(), 'car_accounting_sync', 'car', null, jsonb_build_object('posted', n));
  end if;
  return n;
end $$;
grant execute on function car_accounting_sync_company(uuid) to authenticated;
grant execute on function car_post_vehicle(uuid) to authenticated;
grant execute on function car_post_contract(uuid) to authenticated;
grant execute on function car_post_receipt(uuid) to authenticated;
grant execute on function car_post_charge(uuid) to authenticated;
grant execute on function car_post_charge_payment(uuid) to authenticated;
grant execute on function car_post_commission(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. What Car Sales shows, grouped by the item the voucher named. Every car
--    with that item is counted, whether it is still on the yard or already
--    sold, so the module can show both without a second query.
-- ---------------------------------------------------------------------------
create or replace function car_stock_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with veh as (
    select v.product_id, v.status,
           (v.status in ('in_stock','reserved','held')) as on_hand
    from car_vehicles v
    where v.company_id = auth_company_id() and v.product_id is not null
  ),
  cnt as (
    select product_id,
      count(*) filter (where on_hand) in_stock,
      count(*) filter (where status = 'reserved') reserved,
      count(*) filter (where status in ('sold','delivered')) sold,
      count(*) total
    from veh group by product_id
  ),
  bal as (
    select b.item_id, sum(b.qty) qty, sum(b.value) value
    from stock_balances b
    where b.company_id = auth_company_id() and b.item_id in (select product_id from cnt)
    group by b.item_id
  )
  select jsonb_build_object(
    'total_qty', coalesce((select sum(in_stock) from cnt), 0),
    'total_value', coalesce((select sum(value) from bal), 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'item', pr.name, 'uom', pr.uom,
        'group', (select g.name from acct_products g where g.id = pr.parent_id),
        'qty', c.in_stock, 'reserved', c.reserved, 'sold', c.sold,
        'value', coalesce(b.value, 0),
        'avg_cost', case when coalesce(b.qty,0) <> 0 then round(b.value / b.qty, 2) else 0 end)
        order by pr.name)
      from cnt c
      join acct_products pr on pr.id = c.product_id
      left join bal b on b.item_id = c.product_id
      where c.in_stock > 0), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Undo 273's auto-created Product Tree entries. They were invented by that
-- migration, not by anyone using the ERP, and nothing references them.
-- ---------------------------------------------------------------------------
do $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(p.id), '{}') into v_ids
  from acct_products p
  where exists (select 1 from car_vehicles v where v.product_id = p.id and v.source_product_id is null)
    and not exists (select 1 from stock_movements m where m.item_id = p.id)
    and not exists (select 1 from stock_balances b where b.item_id = p.id)
    and not exists (select 1 from trade_document_lines l where l.product_id = p.id);

  update car_vehicles set product_id = null, stock_product_id = null where product_id = any(v_ids);
  delete from acct_products where id = any(v_ids);

  -- and the groups those items were filed under, if they are now empty.
  delete from acct_products g
  where g.is_group and upper(btrim(g.name)) in ('VEHICLES', 'TRADING VEHICLES')
    and not exists (select 1 from acct_products c where c.parent_id = g.id);
end $$;

-- ---------------------------------------------------------------------------
-- 2. One posting per car purchase.
--
-- A car Purchase Voucher now debits 1160 Vehicle Inventory — the very account
-- the car module's sale entry credits — for the voucher's full total, and
-- credits the supplier. So:
--   * the purchase is booked once, by the voucher, and car_post_vehicle skips it;
--   * the later sale's "Cr 1160" has a matching debit;
--   * the landed-cost extras (insurance, registration, transport…) stay in the
--     vehicle's cost instead of falling into Round Off, because the debit is
--     the voucher total rather than the sum of the line amounts.
-- Everything that is not a car voucher posts exactly as it did before.
-- ---------------------------------------------------------------------------
create or replace function trade_doc_post(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d trade_documents; v_co uuid := auth_company_id(); ln record; is_stk boolean; prc numeric;
        v_stock numeric(18,2) := 0; v_other numeric(18,2) := 0; v_cogs_val numeric(18,2) := 0;
        v_party uuid; v_inv uuid; v_pur uuid; v_sr uuid; v_cogs uuid; v_ro uuid; v_veh uuid;
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
  -- Cars are stocked one unit per vehicle record, by car_vehicle_stock_sync,
  -- and posted to the car module's own inventory account.
  v_is_car := upper(btrim(coalesce(d.cost_center, ''))) in ('CAR SALES INSTALLMENT', 'CAR TRADING');
  -- Warehouse is no longer asked for on the form; fall back to the company's own.
  v_wh := d.warehouse_id;
  if v_upd_stock and not v_is_car and v_wh is null then
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
    -- Purchase Account chosen on the voucher wins; must be a postable account of
    -- this company, otherwise fall back to the auto-named 'Purchases'.
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
