-- The goods in the Product Tree are stock items. The services are not.
--
-- The tree imported in 365 came in with is_stock off on everything, because the
-- old software's export does not carry the flag. Most of that tree is right:
-- hotels, travel routes, visas and permits are services — they are sold, they
-- are costed, and nothing goes on a shelf. Four groups are not services, and
-- they are what this ticks:
--
--   DATES VISTA         5 items   dates, sold by weight
--   TEXTILE PRODUCTS    2 items   ihram and the like
--   TRADING VEHICLE    11 items   cars held for resale
--   VEHICLES           21 items   cars
--
-- SERVICE VEHICLES IS DELIBERATELY LEFT OFF. Its three rows are NUSUK REGISTER,
-- MAKKAH PERMIT and TEST VEHICLE — a registration, a permit and a test row.
-- Nothing there is a vehicle you could count.
--
-- WHAT THE FLAG ACTUALLY DOES, because it is not what the name suggests.
-- `stock_apply` — the one routine that moves goods — never reads is_stock. Nor
-- does `car_vehicle_stock_sync`. The flag is read by nine reports and nothing
-- else:
--
--   is_stock_item, stock_ageing_analysis, stock_item_tree, stock_ledger_report,
--   stock_moving_items, stock_peak_low_balances, stock_reorder_report,
--   stock_statement, stock_virtual_analysis
--
-- So this migration does not start the cars moving. THE CARS ALREADY MOVE. The
-- two rows in stock_movements today are a receipt of +1 and an issue of -1 of
-- HYNDAI STARIA 2022 BLACK — a car that came into stock when its vehicle record
-- was made and left when it was sold, with the flag off the whole time. What
-- the flag changes is that those movements are now VISIBLE: before this, a car
-- moved through the stock ledger and every stock report filtered it out.
--
-- Which is also why the trade lines matter less than they look. A car does not
-- leave stock through the Sales Invoice loop at all:
--
--   trade_doc_post_now:  is_stk := v_upd_stock and not v_is_car
--                                  and coalesce(ln.is_stock,false)
--                                  and ln.product_id is not null
--
-- and v_is_car is set from car_vehicle_from_trade_doc, which opens with
--
--   v_cc := upper(btrim(coalesce(d.cost_center,'')));
--   if v_cc not in ('CAR SALES INSTALLMENT', 'CAR TRADING') then return null; end if;
--
-- The two paths are mutually exclusive by construction: a document on a car cost
-- centre takes the vehicle path and skips the line loop, anything else takes the
-- line loop. Ticking is_stock on the car items therefore cannot double-move a
-- car — the branch that would now see them is the branch a car never enters.
-- The dates and textiles are the opposite case: they have no vehicle path, so
-- for them the tick is what puts the line into the stock loop at all, which is
-- the whole point of ticking them.
--
-- NO uom IS SET. Dates are sold by weight and cars by the unit, and guessing
-- either is the kind of master-data invention this project does not do. The
-- user sets it on the Product Tree.
--
-- Groups are left off: is_stock on a group means nothing and stock_item_tree
-- reads the children.

begin;

do $tick$
declare
  v_grp uuid[];
  v_n   int;
begin
  select array_agg(id) into v_grp
    from acct_products
   where is_group
     and upper(btrim(name)) in ('DATES VISTA', 'TEXTILE PRODUCTS',
                                'TRADING VEHICLE', 'TRADING VEHICLES', 'VEHICLES');

  if v_grp is null or array_length(v_grp, 1) < 4 then
    raise exception '366: expected the four goods groups, found %',
      coalesce(array_length(v_grp, 1), 0);
  end if;

  update acct_products
     set is_stock = true
   where parent_id = any(v_grp)
     and not is_group
     and not is_stock;

  get diagnostics v_n = row_count;
  raise notice '366: ticked % item(s)', v_n;
end
$tick$;

-- Post-conditions. Each one is a way this could have gone wrong.
do $chk$
declare
  v_grp     uuid[];
  v_items   int;
  v_ticked  int;
  v_outside int;
  v_groups  int;
  v_svc     int;
  v_moves   int;
  v_ent     int;
  v_car     record;
  v_seen    int;
  v_visa    int;
begin
  select array_agg(id) into v_grp
    from acct_products
   where is_group
     and upper(btrim(name)) in ('DATES VISTA', 'TEXTILE PRODUCTS',
                                'TRADING VEHICLE', 'TRADING VEHICLES', 'VEHICLES');

  -- 1. every item in the four groups is ticked
  select count(*), count(*) filter (where is_stock) into v_items, v_ticked
    from acct_products where parent_id = any(v_grp) and not is_group;
  if v_items <> v_ticked then
    raise exception '366: % of % item(s) in the goods groups are not ticked',
      v_items - v_ticked, v_items;
  end if;
  if v_items < 39 then
    raise exception '366: only % item(s) in the goods groups, expected at least 39', v_items;
  end if;

  -- 2. nothing outside them was ticked
  select count(*) into v_outside
    from acct_products p
   where p.is_stock
     and not coalesce(p.parent_id = any(v_grp), false);
  if v_outside <> 0 then
    raise exception '366: % item(s) outside the goods groups are ticked', v_outside;
  end if;

  -- 3. no group is ticked
  select count(*) into v_groups from acct_products where is_stock and is_group;
  if v_groups <> 0 then raise exception '366: % group(s) ticked', v_groups; end if;

  -- 4. SERVICE VEHICLES stayed off — a permit is not a vehicle
  select count(*) into v_svc
    from acct_products p
    join acct_products g on g.id = p.parent_id
   where g.is_group and upper(btrim(g.name)) = 'SERVICE VEHICLES' and p.is_stock;
  if v_svc <> 0 then
    raise exception '366: % item(s) under SERVICE VEHICLES got ticked', v_svc;
  end if;

  -- 5. the priced car is untouched apart from the flag, and the five priced
  --    visa items are still there and still unticked (they are a service)
  select name, purchase_rate, total_cost, is_stock, uom into v_car
    from acct_products where purchase_rate = 80000.00;
  if v_car.name is null then raise exception '366: the priced car is gone'; end if;
  if v_car.total_cost <> 100000.00 then
    raise exception '366: the car costs % now, was 100000', v_car.total_cost;
  end if;
  if not v_car.is_stock then raise exception '366: the car is not ticked'; end if;
  if v_car.uom is not null then
    raise exception '366: a uom (%) was invented for the car', v_car.uom;
  end if;

  select count(*) into v_visa
    from acct_products where name like 'UMRAH VISA%' and purchase_rate > 0;
  if v_visa < 5 then
    raise exception '366: only % priced visa item(s) left, expected 5', v_visa;
  end if;

  -- 6. nothing moved and nothing posted. This migration sets a flag.
  select count(*) into v_moves from stock_movements;
  if v_moves <> 2 then
    raise exception '366: stock_movements is % row(s), was 2', v_moves;
  end if;
  select count(*) into v_ent from journal_entries
   where created_at >= now() - interval '1 minute';
  if v_ent <> 0 then raise exception '366: % journal entr(ies) posted', v_ent; end if;

  -- 7. the point of the whole thing: a report that filters on the flag can now
  --    see the car's movements. Before this it could see none of them.
  select count(*) into v_seen
    from stock_movements m
    join acct_products p on p.id = m.item_id
   where p.is_stock;
  if v_seen <> 2 then
    raise exception '366: a stock report sees % of the 2 movement(s)', v_seen;
  end if;

  raise notice '366 ok: % goods item(s) ticked, SERVICE VEHICLES off, % movement(s) now visible',
    v_ticked, v_seen;
end
$chk$;

commit;
