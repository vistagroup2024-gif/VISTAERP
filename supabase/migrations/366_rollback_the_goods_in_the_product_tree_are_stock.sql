-- Rollback of 366 — the stock flag on the goods in the Product Tree.
--
-- It unticks is_stock on the non-group children of DATES VISTA, TEXTILE
-- PRODUCTS, TRADING VEHICLE(S) and VEHICLES, which is every item 366 ticked:
-- before 366 nothing in the tree carried the flag at all, so there is no
-- pre-existing state to preserve here.
--
-- IT REFUSES IF A NON-CAR ITEM HAS MOVED. The cars moved through the stock
-- ledger before 366 and would keep moving after it — car_vehicle_stock_sync
-- never reads the flag — so unticking them only hides history from the nine
-- stock reports, and that is what a rollback of a visibility change should do.
-- The dates and textiles are different: they have no vehicle path, so any
-- movement of one of those exists BECAUSE 366 ticked it, and unticking would
-- leave a stock movement behind that no stock report will show. At that point
-- this is not an import artefact any more and the flag should be turned off on
-- the Product Tree one item at a time, with somebody looking at the ledger.

begin;

do $rb$
declare
  v_grp uuid[];
  v_bad text;
  v_n   int;
begin
  select array_agg(id) into v_grp
    from acct_products
   where is_group
     and upper(btrim(name)) in ('DATES VISTA', 'TEXTILE PRODUCTS',
                                'TRADING VEHICLE', 'TRADING VEHICLES', 'VEHICLES');

  if v_grp is null then
    raise exception '366 rollback: none of the four goods groups exist';
  end if;

  -- a non-car item that has moved
  select string_agg(distinct p.name, ', ') into v_bad
    from acct_products p
    join acct_products g on g.id = p.parent_id
    join stock_movements m on m.item_id = p.id
   where p.parent_id = any(v_grp)
     and not p.is_group
     and upper(btrim(g.name)) in ('DATES VISTA', 'TEXTILE PRODUCTS');

  if v_bad is not null then
    raise exception '366 rollback: % has stock movement(s) that only exist because the flag was on — refusing', v_bad;
  end if;

  update acct_products
     set is_stock = false
   where parent_id = any(v_grp)
     and not is_group
     and is_stock;

  get diagnostics v_n = row_count;
  raise notice '366 rollback: unticked % item(s)', v_n;

  select count(*) into v_n from acct_products where is_stock;
  if v_n <> 0 then
    raise exception '366 rollback: % item(s) still ticked', v_n;
  end if;
end
$rb$;

commit;
