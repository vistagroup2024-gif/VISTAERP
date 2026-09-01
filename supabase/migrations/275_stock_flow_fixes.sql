-- 275_stock_flow_fixes.sql
-- Bugs found reviewing the whole purchase → stock → sale flow.
--
--  1. Internal helpers were callable by any signed-in user. stock_apply and the
--     car posting helpers take a company or a row id and do their work without
--     an authorisation check, because the only callers are triggers and other
--     security-definer functions. Granting them to `authenticated` let a
--     non-staff account (a B2B agent, a driver) forge stock or post journals
--     for any company. They are internal, so the grants are withdrawn.
--  2. Deleting a vehicle left its stock behind. A car still in_stock can be
--     deleted, and nothing took its unit off the shelf.
--  3. A posted document could be deleted through the API. The screen disables
--     the button, but the function never checked, so a posted purchase could be
--     removed while its journal, its stock and its vehicles stayed.
--  4. Reports disagreed about which items count. Valuation, Movement and the
--     Opening Register read the movement ledger and so showed cars; the Ledger,
--     Statement, Ageing and the rest filtered on the "stock item" tick and did
--     not. An item that has actually moved is a stock item whether or not the
--     box is ticked — and the Product Tree is the user's to tick.

-- ---------------------------------------------------------------------------
-- 1. Internal helpers are internal.
-- ---------------------------------------------------------------------------
revoke all on function stock_apply(uuid, text, uuid, uuid, numeric, numeric, date, text, text) from public, authenticated;
revoke all on function car_stock_warehouse(uuid) from public, authenticated;
revoke all on function car_vehicle_product(uuid) from public, authenticated;
revoke all on function car_vehicle_stock_sync(uuid) from public, authenticated;
revoke all on function car_accounting_sync_company(uuid) from public, authenticated;
revoke all on function car_post_vehicle(uuid) from public, authenticated;
revoke all on function car_post_contract(uuid) from public, authenticated;
revoke all on function car_post_receipt(uuid) from public, authenticated;
revoke all on function car_post_charge(uuid) from public, authenticated;
revoke all on function car_post_charge_payment(uuid) from public, authenticated;
revoke all on function car_post_commission(uuid) from public, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A deleted vehicle takes its unit off the shelf with it.
-- ---------------------------------------------------------------------------
create or replace function car_vehicle_stock_release()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text; v_state text; v_ctx text;
begin
  if old.stock_product_id is not null then
    begin
      perform stock_apply(old.company_id, 'issue', old.stock_product_id,
        car_stock_warehouse(old.company_id), 1, 0, current_date, old.vehicle_no,
        'Vehicle ' || old.vehicle_no || ' deleted');
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
      raise warning 'car stock release (%) failed [%]: % / %', old.id, v_state, v_err, v_ctx;
      begin
        insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (old.company_id, auth.uid(), 'car_stock_release_failed', 'car_vehicle', old.id,
                jsonb_build_object('sqlstate', v_state, 'message', v_err, 'context', v_ctx));
      exception when others then null; end;
    end;
  end if;
  return old;
end $$;

drop trigger if exists trg_car_vehicle_stock_delete on car_vehicles;
create trigger trg_car_vehicle_stock_delete before delete on car_vehicles
  for each row execute function car_vehicle_stock_release();

-- ---------------------------------------------------------------------------
-- 3. A posted document cannot be deleted.
-- ---------------------------------------------------------------------------
create or replace function trade_doc_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_gl uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select gl_entry into v_gl from trade_documents where id = p_id and company_id = auth_company_id();
  if not found then raise exception 'Document not found'; end if;
  if v_gl is not null then
    raise exception 'This document is posted to the General Ledger and cannot be deleted.';
  end if;
  delete from trade_documents where id = p_id and company_id = auth_company_id();
end $$;
grant execute on function trade_doc_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. One rule for what counts as a stock item across every report: the tick in
--    the Product Tree, OR any movement on the ledger. A car that arrived on a
--    Purchase Voucher shows up either way, and the tick stays the user's.
-- ---------------------------------------------------------------------------
create or replace function is_stock_item(p_product uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_stock from acct_products p where p.id = p_product), false)
      or exists (select 1 from stock_movements m where m.item_id = p_product);
$$;

create or replace function stock_item_tree()
returns jsonb language sql stable security definer set search_path = public as $$
  with bal as (
    select b.item_id, sum(b.qty) qty from stock_balances b
    where b.company_id = auth_company_id() group by b.item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'parent_id', p.parent_id, 'name', p.name, 'is_group', p.is_group,
    'uom', p.uom, 'qty', coalesce(b.qty, 0),
    'reorder_level', p.reorder_level, 'reorder_qty', p.reorder_qty)
    order by p.is_group desc, p.sort, p.name), '[]'::jsonb)
  from acct_products p
  left join bal b on b.item_id = p.id
  where p.company_id = auth_company_id() and p.is_active
    and (p.is_group or is_stock_item(p.id));
$$;

-- The same predicate in every report that used to read the tick directly.
create or replace function stock_ledger_report(
  p_from date, p_to date, p_items uuid[] default null, p_wh uuid default null, p_moved_only boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with sel as (
    select p.id, p.name, p.uom
    from acct_products p
    where p.company_id = auth_company_id() and is_stock_item(p.id) and not p.is_group
      and (p_items is null or p.id = any(p_items))
  ),
  mv as (
    select m.id, m.item_id, m.doc_date, m.doc_no, m.doc_type, m.qty, m.rate, m.value,
           m.reference, m.narration, m.created_at, sign(m.qty) * m.value as signed_value
    from stock_movements m
    where m.company_id = auth_company_id() and (p_wh is null or m.warehouse_id = p_wh)
  ),
  opening as (
    select s.id item_id,
           coalesce(sum(mv.qty), 0) qty,
           coalesce(sum(mv.signed_value), 0) value
    from sel s
    left join mv on mv.item_id = s.id and p_from is not null and mv.doc_date < p_from
    group by s.id
  ),
  period as (
    select s.id item_id, mv.id mid, mv.doc_date, mv.doc_no, mv.doc_type, mv.qty, mv.rate,
           mv.value, mv.signed_value, mv.created_at,
           coalesce(pa.name, td.narration, mv.narration, mv.reference) as counterparty
    from sel s
    join mv on mv.item_id = s.id
    left join trade_documents td on td.doc_no = mv.reference and td.company_id = auth_company_id()
    left join parties pa on pa.id = td.party_id
    where (p_from is null or mv.doc_date >= p_from) and (p_to is null or mv.doc_date <= p_to)
  ),
  ranked as (
    select p.*,
      o.qty + sum(p.qty) over w as bal_qty,
      o.value + sum(p.signed_value) over w as bal_value
    from period p
    join opening o on o.item_id = p.item_id
    window w as (partition by p.item_id order by p.doc_date, p.created_at, p.mid
                 rows between unbounded preceding and current row)
  ),
  per_item as (
    select s.id, s.name, s.uom, o.qty op_qty, o.value op_value,
      coalesce((select jsonb_agg(jsonb_build_object(
        'date', r.doc_date, 'voucher_no', r.doc_no, 'name', r.counterparty, 'doc_type', r.doc_type,
        'qty_rec', case when r.qty > 0 then r.qty else 0 end,
        'rate_rec', case when r.qty > 0 then r.rate else 0 end,
        'rec_value', case when r.qty > 0 then r.value else 0 end,
        'qty_iss', case when r.qty < 0 then -r.qty else 0 end,
        'rate_iss', case when r.qty < 0 then r.rate else 0 end,
        'iss_value', case when r.qty < 0 then r.value else 0 end,
        'bal_qty', r.bal_qty, 'bal_value', r.bal_value)
        order by r.doc_date, r.created_at, r.mid)
        from ranked r where r.item_id = s.id), '[]'::jsonb) entries
    from sel s join opening o on o.item_id = s.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', id, 'item', name, 'uom', uom,
    'opening_qty', op_qty, 'opening_value', op_value,
    'rows', entries) order by name), '[]'::jsonb)
  from per_item
  where not coalesce(p_moved_only, false) or jsonb_array_length(entries) > 0;
$$;

create or replace function stock_statement(
  p_from date, p_to date, p_items uuid[] default null, p_wh uuid default null, p_moved_only boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with sel as (
    select p.id, p.name, p.uom, p.parent_id
    from acct_products p
    where p.company_id = auth_company_id() and is_stock_item(p.id) and not p.is_group
      and (p_items is null or p.id = any(p_items))
  ),
  mv as (
    select m.item_id, m.doc_date, m.qty, m.value, sign(m.qty) * m.value signed_value,
           (p_from is not null and m.doc_date < p_from) as is_opening,
           ((p_from is null or m.doc_date >= p_from) and (p_to is null or m.doc_date <= p_to)) as in_period
    from stock_movements m
    where m.company_id = auth_company_id() and (p_wh is null or m.warehouse_id = p_wh)
  ),
  agg as (
    select s.id, s.name, s.uom, s.parent_id,
      coalesce(sum(mv.qty) filter (where mv.is_opening), 0) op_qty,
      coalesce(sum(mv.signed_value) filter (where mv.is_opening), 0) op_value,
      coalesce(sum(mv.qty) filter (where mv.in_period and mv.qty > 0), 0) in_qty,
      coalesce(sum(mv.value) filter (where mv.in_period and mv.qty > 0), 0) in_value,
      coalesce(sum(-mv.qty) filter (where mv.in_period and mv.qty < 0), 0) out_qty,
      coalesce(sum(mv.value) filter (where mv.in_period and mv.qty < 0), 0) out_value,
      count(*) filter (where mv.in_period) moves
    from sel s left join mv on mv.item_id = s.id
    group by s.id, s.name, s.uom, s.parent_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', id, 'item', name, 'uom', uom, 'group_id', parent_id,
    'opening_qty', op_qty, 'opening_value', op_value,
    'in_qty', in_qty, 'in_value', in_value,
    'out_qty', out_qty, 'out_value', out_value,
    'closing_qty', op_qty + in_qty - out_qty,
    'closing_value', op_value + in_value - out_value,
    'moves', moves) order by name), '[]'::jsonb)
  from agg
  where not coalesce(p_moved_only, false) or moves > 0;
$$;

create or replace function stock_virtual_analysis(p_wh uuid default null, p_items uuid[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with onhand as (
    select b.item_id, sum(b.qty) qty, sum(b.value) value
    from stock_balances b
    where b.company_id = auth_company_id() and (p_wh is null or b.warehouse_id = p_wh)
    group by b.item_id
  ),
  pipeline as (
    select l.product_id item_id,
      sum(case when d.doc_type in ('purchase_order','mrn') then l.quantity else 0 end) on_order,
      sum(case when d.doc_type in ('sale_order','delivery_note') then l.quantity else 0 end) committed
    from trade_documents d
    join trade_document_lines l on l.doc_id = d.id
    where d.company_id = auth_company_id() and l.product_id is not null
      and d.doc_type in ('purchase_order','mrn','sale_order','delivery_note')
      and coalesce(d.status, 'draft') not in ('cancelled', 'closed')
      and (p_wh is null or d.warehouse_id is null or d.warehouse_id = p_wh)
    group by l.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', pr.name, 'uom', pr.uom,
    'on_hand', coalesce(h.qty, 0), 'value', coalesce(h.value, 0),
    'on_order', coalesce(p.on_order, 0), 'committed', coalesce(p.committed, 0),
    'virtual', coalesce(h.qty, 0) + coalesce(p.on_order, 0) - coalesce(p.committed, 0),
    'reorder_level', pr.reorder_level,
    'short', (coalesce(h.qty,0) + coalesce(p.on_order,0) - coalesce(p.committed,0)) < pr.reorder_level)
    order by pr.name), '[]'::jsonb)
  from acct_products pr
  left join onhand h on h.item_id = pr.id
  left join pipeline p on p.item_id = pr.id
  where pr.company_id = auth_company_id() and is_stock_item(pr.id) and not pr.is_group and pr.is_active
    and (p_items is null or pr.id = any(p_items))
    and (coalesce(h.qty,0) <> 0 or coalesce(p.on_order,0) <> 0 or coalesce(p.committed,0) <> 0);
$$;

create or replace function stock_reorder_report(p_wh uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with onhand as (
    select b.item_id, sum(b.qty) qty from stock_balances b
    where b.company_id = auth_company_id() and (p_wh is null or b.warehouse_id = p_wh)
    group by b.item_id
  ),
  onorder as (
    select l.product_id item_id, sum(l.quantity) qty
    from trade_documents d join trade_document_lines l on l.doc_id = d.id
    where d.company_id = auth_company_id() and d.doc_type = 'purchase_order'
      and coalesce(d.status, 'draft') not in ('cancelled', 'closed') and l.product_id is not null
    group by l.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', pr.id, 'item', pr.name, 'uom', pr.uom,
    'qty', coalesce(h.qty, 0), 'on_order', coalesce(o.qty, 0),
    'reorder_level', pr.reorder_level, 'reorder_qty', pr.reorder_qty,
    'shortfall', greatest(pr.reorder_level - coalesce(h.qty, 0), 0),
    'suggested', greatest(case when pr.reorder_qty > 0 then pr.reorder_qty
                               else pr.reorder_level - coalesce(h.qty, 0) end, 0))
    order by (pr.reorder_level - coalesce(h.qty, 0)) desc, pr.name), '[]'::jsonb)
  from acct_products pr
  left join onhand h on h.item_id = pr.id
  left join onorder o on o.item_id = pr.id
  where pr.company_id = auth_company_id() and is_stock_item(pr.id) and not pr.is_group and pr.is_active
    and pr.reorder_level > 0 and coalesce(h.qty, 0) <= pr.reorder_level;
$$;

create or replace function stock_moving_items(
  p_from date, p_to date, p_mode text default 'fast', p_limit int default 50, p_wh uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with mv as (
    select m.item_id,
      sum(case when m.qty < 0 then -m.qty else 0 end) out_qty,
      sum(case when m.qty < 0 then m.value else 0 end) out_value,
      count(*) filter (where m.qty < 0) issues,
      max(case when m.qty < 0 then m.doc_date end) last_issue
    from stock_movements m
    where m.company_id = auth_company_id()
      and (p_from is null or m.doc_date >= p_from) and (p_to is null or m.doc_date <= p_to)
      and (p_wh is null or m.warehouse_id = p_wh)
    group by m.item_id
  ),
  bal as (
    select b.item_id, sum(b.qty) qty, sum(b.value) value from stock_balances b
    where b.company_id = auth_company_id() and (p_wh is null or b.warehouse_id = p_wh)
    group by b.item_id
  ),
  base as (
    select pr.id, pr.name, pr.uom,
      coalesce(m.out_qty, 0) out_qty, coalesce(m.out_value, 0) out_value,
      coalesce(m.issues, 0) issues, m.last_issue,
      coalesce(b.qty, 0) balance, coalesce(b.value, 0) balance_value
    from acct_products pr
    left join mv m on m.item_id = pr.id
    left join bal b on b.item_id = pr.id
    where pr.company_id = auth_company_id() and is_stock_item(pr.id) and not pr.is_group and pr.is_active
  ),
  picked as (
    select * from base
    order by case when p_mode = 'slow' then out_qty else -out_qty end, name
    limit greatest(coalesce(p_limit, 50), 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', name, 'uom', uom, 'out_qty', out_qty, 'out_value', out_value,
    'issues', issues, 'last_issue', last_issue,
    'balance', balance, 'balance_value', balance_value,
    'days_idle', case when last_issue is null then null else least(coalesce(p_to, current_date), current_date) - last_issue end)
    order by case when p_mode = 'slow' then out_qty else -out_qty end, name), '[]'::jsonb)
  from picked;
$$;

create or replace function stock_peak_low_balances(
  p_from date, p_to date, p_items uuid[] default null, p_wh uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with sel as (
    select p.id, p.name, p.uom from acct_products p
    where p.company_id = auth_company_id() and is_stock_item(p.id) and not p.is_group and p.is_active
      and (p_items is null or p.id = any(p_items))
  ),
  mv as (
    select m.item_id, m.doc_date, m.created_at, m.id, m.qty
    from stock_movements m
    where m.company_id = auth_company_id() and (p_wh is null or m.warehouse_id = p_wh)
      and (p_to is null or m.doc_date <= p_to)
  ),
  opening as (
    select s.id item_id, coalesce(sum(mv.qty), 0) qty
    from sel s
    left join mv on mv.item_id = s.id and p_from is not null and mv.doc_date < p_from
    group by s.id
  ),
  running as (
    select mv.item_id, mv.doc_date, mv.created_at, mv.id,
      o.qty + sum(mv.qty) over (partition by mv.item_id order by mv.doc_date, mv.created_at, mv.id
                                rows between unbounded preceding and current row) bal
    from mv join opening o on o.item_id = mv.item_id
    where p_from is null or mv.doc_date >= p_from
  ),
  ext as (
    select item_id, max(bal) peak, min(bal) low,
      (array_agg(doc_date order by bal desc, doc_date))[1] peak_date,
      (array_agg(doc_date order by bal asc, doc_date))[1] low_date,
      -- same-day movements tie on doc_date, so close on the ledger's own order
      (array_agg(bal order by doc_date desc, created_at desc, id desc))[1] closing
    from running group by item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', s.name, 'uom', s.uom,
    'opening', o.qty,
    'peak', coalesce(e.peak, o.qty), 'peak_date', e.peak_date,
    'low', coalesce(e.low, o.qty), 'low_date', e.low_date,
    'closing', coalesce(e.closing, o.qty))
    order by s.name), '[]'::jsonb)
  from sel s
  join opening o on o.item_id = s.id
  left join ext e on e.item_id = s.id
  where e.item_id is not null or o.qty <> 0;
$$;

create or replace function stock_ageing_analysis(
  p_as_of date default null, p_wh uuid default null, p_items uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); v_as date := coalesce(p_as_of, current_date);
        r record; v_out jsonb := '[]'::jsonb;
        v_issue numeric; lot record; v_take numeric; v_left numeric;
        b0 numeric; b1 numeric; b2 numeric; b3 numeric; b4 numeric; v_val numeric; v_age int;
begin
  for r in
    select pr.id, pr.name, pr.uom
    from acct_products pr
    where pr.company_id = v_co and is_stock_item(pr.id) and not pr.is_group and pr.is_active
      and (p_items is null or pr.id = any(p_items))
    order by pr.name
  loop
    -- Total issued up to the date, then walk the receipts oldest-first and knock
    -- it off; the remainder of each receipt is stock still on the shelf.
    select coalesce(sum(-m.qty), 0) into v_issue from stock_movements m
      where m.company_id = v_co and m.item_id = r.id and m.qty < 0 and m.doc_date <= v_as
        and (p_wh is null or m.warehouse_id = p_wh);

    b0 := 0; b1 := 0; b2 := 0; b3 := 0; b4 := 0; v_val := 0;
    for lot in
      select m.doc_date, m.qty, case when m.qty <> 0 then m.value / m.qty else 0 end rate
      from stock_movements m
      where m.company_id = v_co and m.item_id = r.id and m.qty > 0 and m.doc_date <= v_as
        and (p_wh is null or m.warehouse_id = p_wh)
      order by m.doc_date, m.created_at
    loop
      v_take := least(lot.qty, v_issue);
      v_issue := v_issue - v_take;
      v_left := lot.qty - v_take;
      if v_left <= 0 then continue; end if;
      v_age := v_as - lot.doc_date;
      if    v_age <= 30  then b0 := b0 + v_left;
      elsif v_age <= 60  then b1 := b1 + v_left;
      elsif v_age <= 90  then b2 := b2 + v_left;
      elsif v_age <= 180 then b3 := b3 + v_left;
      else                    b4 := b4 + v_left; end if;
      v_val := v_val + round(v_left * lot.rate, 2);
    end loop;

    if b0 + b1 + b2 + b3 + b4 > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'item', r.name, 'uom', r.uom,
        'qty', b0 + b1 + b2 + b3 + b4, 'value', v_val,
        'd0_30', b0, 'd31_60', b1, 'd61_90', b2, 'd91_180', b3, 'd180_plus', b4));
    end if;
  end loop;
  return v_out;
end $$;

grant execute on function is_stock_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The cars must cost exactly what the voucher posted.
--
-- Splitting the total between the lines and then between the units rounds twice,
-- so 100,000 over three cars gave 33,333.33 each — 99,999.99 of stock against a
-- 100,000 debit to Vehicle Inventory. A cent per voucher, never reconciling.
-- The remainder now lands on the last unit of the last line, so the vehicles
-- always add up to the voucher total exactly.
-- ---------------------------------------------------------------------------
create or replace function car_vehicle_from_trade_doc(p_doc uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d trade_documents; v_cc text; v_id uuid; v_first uuid; v_no text;
        ln record; v_units int; v_have int; v_share numeric; v_unit numeric;
        v_lines_qty numeric; v_lines_amt numeric; v_total numeric;
        v_line_n int := 0; v_lines int; v_alloc numeric := 0; v_left numeric; k int;
begin
  select * into d from trade_documents where id = p_doc;
  if not found then return null; end if;
  if d.doc_type <> 'purchase_voucher' then return null; end if;
  v_cc := upper(btrim(coalesce(d.cost_center, '')));
  if v_cc not in ('CAR SALES INSTALLMENT', 'CAR TRADING') then return null; end if;

  v_total := coalesce(d.total, 0);
  select coalesce(sum(greatest(round(coalesce(l.quantity, 1)), 1)), 0),
         coalesce(sum(coalesce(l.amount, 0)), 0), count(*)
    into v_lines_qty, v_lines_amt, v_lines
    from trade_document_lines l where l.doc_id = p_doc;

  if v_lines_qty = 0 then
    -- A voucher with no lines still buys a car: keep the old one-per-voucher
    -- behaviour rather than dropping it on the floor.
    select id into v_id from car_vehicles where source_trade_doc = p_doc limit 1;
    if v_id is not null then return v_id; end if;
    v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
    insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
      ownership, is_trading, status, notes, source_trade_doc)
    values (d.company_id, v_no, d.party_id, d.doc_date, v_total,
      'vista', v_cc = 'CAR TRADING', 'in_stock',
      'Created from Purchase Voucher ' || coalesce(d.doc_no, ''), p_doc)
    returning id into v_id;
    return v_id;
  end if;

  for ln in select l.id, l.product_id, l.quantity, l.amount
            from trade_document_lines l where l.doc_id = p_doc order by l.sort, l.id loop
    v_line_n := v_line_n + 1;
    v_units := greatest(round(coalesce(ln.quantity, 1))::int, 1);

    -- The voucher total carries the landed cost, so split THAT between the
    -- lines — by what each line is worth, not by how many units it holds. The
    -- last line takes whatever is left, so the split is exact.
    if v_line_n = v_lines then
      v_share := v_total - v_alloc;
    elsif v_lines_amt > 0 then
      v_share := round(v_total * (coalesce(ln.amount, 0) / v_lines_amt), 2);
    else
      v_share := round(v_total * (v_units::numeric / v_lines_qty), 2);
    end if;
    v_alloc := v_alloc + v_share;

    select count(*) into v_have from car_vehicles where source_doc_line = ln.id;
    v_unit := round(v_share / v_units, 2);
    v_left := v_share - v_unit * (v_units - 1);   -- the last unit absorbs the rest

    for k in (v_have + 1)..v_units loop
      v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
      insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
        ownership, is_trading, status, notes, source_trade_doc, source_doc_line, source_product_id)
      values (d.company_id, v_no, d.party_id, d.doc_date,
        case when k = v_units then v_left else v_unit end,
        'vista', v_cc = 'CAR TRADING', 'in_stock',
        'Created from Purchase Voucher ' || coalesce(d.doc_no, ''), p_doc, ln.id, ln.product_id)
      returning id into v_id;
      if v_first is null then v_first := v_id; end if;
    end loop;
  end loop;

  if v_first is null then select id into v_first from car_vehicles where source_trade_doc = p_doc limit 1; end if;
  return v_first;
end $$;

-- ---------------------------------------------------------------------------
-- 6. A car Purchase Return is refused rather than half-done.
--
-- Cars are stocked one unit per vehicle record, and a return line names an item
-- and a quantity — never WHICH cars came back. Posting it credited Vehicle
-- Inventory while the vehicles stayed on the yard, so the ledger and the stock
-- drifted apart with nothing to show why. Until a return can point at the
-- vehicles it returns, the voucher says so instead of quietly diverging.
-- ---------------------------------------------------------------------------
create or replace function trade_doc_car_return_guard()
returns trigger language plpgsql as $$
begin
  if new.gl_entry is not null and old.gl_entry is null
     and new.doc_type = 'purchase_return'
     and upper(btrim(coalesce(new.cost_center, ''))) in ('CAR SALES INSTALLMENT', 'CAR TRADING') then
    raise exception 'A car Purchase Return cannot be posted: it cannot say which vehicles came back. Cancel or delete the vehicle records instead.';
  end if;
  return new;
end $$;

drop trigger if exists trg_trade_doc_car_return_guard on trade_documents;
create trigger trg_trade_doc_car_return_guard before update on trade_documents
  for each row execute function trade_doc_car_return_guard();
