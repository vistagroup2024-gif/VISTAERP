-- Restores the Sale Order · Advance vs Receipt card, corrected.
--
-- 336 removed this card. That was wrong: the ask was to take an INVOICED sale
-- order OFF it, not to take the card away. It is back, with both faults fixed.
--
-- 1. IT SHOWS ONLY ORDERS STILL AWAITING THEIR INVOICE. An order appears when
--    it is raised and leaves the moment a Car Invoice is made from it. That
--    works because 336 taught `consumed` that a car_contract pointing back with
--    source_doc_id finishes a document, just as a downstream trade document
--    does.
--
-- 2. BALANCE = ADVANCE − RECEIVED. It was order_value − (advance + collected),
--    which answered a different question and was wrong on its own terms: the
--    balance on an advance is how much of THE ADVANCE has not arrived, not how
--    much of the order is unpaid.
--
-- A CAVEAT THAT NEEDS A DECISION, recorded here so it is not lost: a Sale Order
-- has nowhere to record an advance. There is no advance column on
-- trade_documents and no advance field on the Sale Order screen. The only
-- advance in the ERP is on the Car Invoice — which is exactly what removes the
-- order from this card. So Advance and Received here are structurally 0 until
-- an advance can be agreed on the ORDER. The card is shaped correctly and will
-- fill itself in the day that field exists; it is not quietly guessing a number
-- in the meantime.

do $mig$
declare
  v_def text; v_new text; i int;
  blk constant text := $b$  'so_advance_receipt', jsonb_build_object(
    -- Only sale orders still AWAITING their invoice. A Car Invoice raised from
    -- one finishes it, and `consumed` knows about car contracts now, so it
    -- drops off this card the moment the invoice exists.
    'order_value', (select coalesce(sum(total), 0) from td
                     where doc_type = 'sale_order' and not consumed),
    'advance',     (select coalesce(sum(c.advance), 0) from car_contracts c
                     where c.company_id = (select id from co)
                       and c.source_doc_id in (select id from td
                                                where doc_type = 'sale_order' and not consumed)),
    'received',    (select coalesce(sum(r.amount), 0) from car_receipts r
                     where r.company_id = (select id from co)
                       and r.contract_id in (select cc.id from car_contracts cc
                                              where cc.source_doc_id in (select id from td
                                                     where doc_type = 'sale_order' and not consumed))),
    -- BALANCE IS THE ADVANCE STILL TO COME IN, not the order less everything.
    'balance',     (select coalesce(sum(c.advance), 0) from car_contracts c
                     where c.company_id = (select id from co)
                       and c.source_doc_id in (select id from td
                                                where doc_type = 'sale_order' and not consumed))
                 - (select coalesce(sum(r.amount), 0) from car_receipts r
                     where r.company_id = (select id from co)
                       and r.contract_id in (select cc.id from car_contracts cc
                                              where cc.source_doc_id in (select id from td
                                                     where doc_type = 'sale_order' and not consumed)))),
$b$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dashboard_metrics';

  if v_def like '%so_advance_receipt%' then
    raise notice 'Already present.'; return;
  end if;

  i := position('  ''purchase_vs_sale'', jsonb_build_object(' in v_def);
  if i = 0 then raise exception 'Cannot find where to put it back.'; end if;
  if (select count(*) from regexp_matches(v_def, '  ''purchase_vs_sale'', jsonb_build_object\(', 'g')) <> 1 then
    raise exception 'purchase_vs_sale appears more than once.';
  end if;

  v_new := substring(v_def for i - 1) || blk || substring(v_def from i);

  if v_new not like '%so_advance_receipt%' or v_new not like '%''purchase_vs_sale''%' then
    raise exception 'The restore did not land cleanly.';
  end if;

  execute v_new;
  raise notice 'Card restored: pending sale orders only, balance = advance - received.';
end $mig$;

-- ---------------------------------------------------------------------------
-- Correction to the caveat above: THE SALE ORDER DOES CARRY AN ADVANCE.
--
-- I looked for an `advance` COLUMN on trade_documents, found none, and reported
-- that a Sale Order had nowhere to record one. It has: a car Sale Order shows a
-- Car Sales Details block (lib/tradeDocs.ts, CAR_COSTING) with Total Cost,
-- Advance, Investment, Installment Months, Percentage, Margin, Selling Price
-- and an Advance Due Date, and those live in trade_documents.meta as JSON.
-- SO-00001 holds advance "40000" and advance_due_date "2026-09-08".
--
-- So the advance is read off THE ORDER now, which is the whole point of the
-- card: an order shows what advance was agreed on it, and leaves when its Car
-- Invoice is raised. Reading it off the car contract, as it did before, could
-- only ever have shown money belonging to orders that had already left.
--
-- meta values are strings typed by a user, so anything that is not plainly a
-- number counts as 0 rather than throwing the whole dashboard on one bad cast.
