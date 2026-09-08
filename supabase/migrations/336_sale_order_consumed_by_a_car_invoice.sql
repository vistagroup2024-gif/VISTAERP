-- A Sale Order turned into a Car Invoice is finished with.
--
-- "Consumed" on the dashboard meant "some trade document was raised from this
-- one". A Car Invoice is not a trade document — it is a car_contract pointing
-- back with source_doc_id — so a Sale Order that had become a Car Invoice was
-- still counted as an open sale order, for ever. SO-00001 became CI-000003 and
-- was still sitting there as `open`.
--
-- The Load picker already knew better: car_pending_sale_orders excludes an
-- order that has a car contract, so the same order could never be sold twice.
-- It was only the dashboard that had not been told.
--
-- AND THE "SALE ORDER · ADVANCE VS RECEIPT" CARD IS GONE. It paired a SALE
-- ORDER total with a CAR CONTRACT's advance and collections — two different
-- documents about two different pots of money, sitting side by side as though
-- they were one statement. It only ever looked plausible because there was one
-- of each. The advance belongs to the customer, and is now on Car Customer
-- Balances (it counts toward Due on its own due date) and in the customer's own
-- ledger, which is where a balance is answered from.
--
-- Both blocks are replaced by position, from their own start to the next
-- section, after checking each boundary appears exactly once.

do $mig$
declare
  v_def text; v_new text; i1 int; i2 int;
  new_td constant text := $td$  td as (
    -- "Consumed" means something downstream was raised from this document. A
    -- Car Invoice is one of those, and it is NOT a trade document — it is a
    -- car_contract pointing back with source_doc_id. Without this a Sale Order
    -- turned into a Car Invoice stayed on the books as an open sale order for
    -- ever, because nothing in trade_documents had claimed it.
    select d.*,
           (exists (select 1 from trade_documents x where x.source_doc_id = d.id)
            or exists (select 1 from car_contracts cc where cc.source_doc_id = d.id)) as consumed
    from trade_documents d where d.company_id = (select id from co)
  ),
$td$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dashboard_metrics';

  if v_def like '%car_contracts cc where cc.source_doc_id%' then
    raise notice 'Already applied.'; return;
  end if;

  i1 := position('  td as (' in v_def);
  i2 := position('  stock as (' in v_def);
  if i1 = 0 or i2 = 0 or i2 <= i1 then raise exception 'Cannot locate the td block.'; end if;
  v_new := substring(v_def for i1 - 1) || new_td || substring(v_def from i2);

  i1 := position('  ''so_advance_receipt'', jsonb_build_object(' in v_new);
  i2 := position('  ''purchase_vs_sale'', jsonb_build_object(' in v_new);
  if i1 = 0 or i2 = 0 or i2 <= i1 then raise exception 'Cannot locate the so_advance_receipt block.'; end if;
  v_new := substring(v_new for i1 - 1) || substring(v_new from i2);

  if v_new like '%so_advance_receipt%' then
    raise exception 'so_advance_receipt survived the cut.';
  end if;
  if v_new not like '%as consumed%' or v_new not like '%''purchase_vs_sale''%' then
    raise exception 'The cut took something it should not have.';
  end if;

  execute v_new;
  raise notice 'A Car Invoice now consumes its Sale Order; SO Advance vs Receipt is gone.';
end $mig$;
