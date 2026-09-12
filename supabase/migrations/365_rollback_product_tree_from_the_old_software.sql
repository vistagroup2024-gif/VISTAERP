-- Rollback of 365 — the product tree imported from Product_Tree.xlsx.
--
-- It removes the 8 groups and 274 items the import created, and refuses if any
-- of them is named on a trade document line, a stock movement or a costing row,
-- because by then it is not an import artefact: it is an item somebody sold.
--
-- WHAT IT LEAVES: the two groups that existed before (TRADING VEHICLE, VISA) and
-- the six priced items inside them, which the import reused and never touched.
-- Also the sort order it wrote onto those two groups — a number nobody reads.
--
-- Identification is by created_at inside the import's own transaction: every row
-- 365 made carries that one timestamp, because created_at defaults to now() and
-- now() is the transaction's start.

begin;

do $rb$
declare v_ts timestamptz; v_n int; v_bad text;
begin
  -- the import's timestamp is whatever the bulk of the tree carries
  select created_at into v_ts from acct_products
   group by created_at order by count(*) desc limit 1;
  if v_ts is null then raise exception '365 rollback: no products to work from'; end if;

  select count(*) into v_n from acct_products where created_at = v_ts;
  if v_n < 200 then
    raise exception '365 rollback: only % product(s) share that timestamp — that is not the import, refusing', v_n;
  end if;

  select string_agg(distinct p.name, ', ') into v_bad
    from acct_products p
   where p.created_at = v_ts
     and (exists (select 1 from trade_document_lines l where l.product_id = p.id)
       or exists (select 1 from stock_movements m where m.item_id = p.id)
       or exists (select 1 from acct_product_costing c where c.product_id = p.id));
  if v_bad is not null then
    raise exception '365 rollback: these are in use and cannot be removed: %', v_bad;
  end if;

  -- children first, then the groups they hung off
  delete from acct_products where created_at = v_ts and not is_group;
  get diagnostics v_n = row_count;
  raise notice '365 rollback: removed % item(s)', v_n;

  delete from acct_products where created_at = v_ts and is_group
    and not exists (select 1 from acct_products c where c.parent_id = acct_products.id);
  get diagnostics v_n = row_count;
  raise notice '365 rollback: removed % group(s)', v_n;
end $rb$;

do $chk$
declare v_co uuid; v_n int;
begin
  select company_id into v_co from profiles p
    join user_roles ur on ur.user_id = p.id where ur.role='admin' limit 1;

  -- the six priced items must have survived, and visa pricing must still resolve
  select count(*) into v_n from acct_products
   where company_id=v_co and not is_group and (purchase_rate > 0 or sell_rate > 0);
  if v_n < 6 then raise exception '365 rollback: only % priced item(s) left, expected at least 6', v_n; end if;
  if visa_pick_product(v_co, 'masar', 0) is null
     or visa_pick_product(v_co, 'long_stay', 0) is null
     or visa_pick_product(v_co, 'normal', 12) is null
  then raise exception '365 rollback: visa_pick_product no longer resolves'; end if;

  select count(*) into v_n from acct_products c
   where c.parent_id is not null and not exists (select 1 from acct_products p where p.id=c.parent_id);
  if v_n <> 0 then raise exception '365 rollback: % orphaned item(s)', v_n; end if;
end $chk$;

commit;
