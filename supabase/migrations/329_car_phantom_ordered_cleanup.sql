-- Clearing up after the duplicate, and stopping a moved expense from lying.
--
-- 328 stopped the vehicle list offering a purchase order whose cars have
-- already arrived. It could not undo what the earlier behaviour had already
-- made: a second vehicle record, status `ordered`, standing for a car that is
-- in the yard under another number — with whatever expenses were booked on it
-- while it was there.
--
-- Those records are recognisable without guessing. An `ordered` vehicle is a
-- phantom when the purchase order it names has since produced, through its own
-- Purchase Voucher, at least as many cars of that item as it ordered. Nothing
-- is on order any more, so nothing can still be `ordered` against it.
--
-- The repair moves the phantom's expenses onto the car that really arrived and
-- deletes the phantom. NOTHING IS POSTED OR UNPOSTED: an expense's ledger entry
-- debits Vehicle Inventory either way, so moving which car carries the cost
-- leaves the GL untouched. A phantom carrying anything else at all — a
-- contract, a delivery, a holding, a transfer, a service charge, a purchase
-- order item — is left exactly where it is and reported, because that is no
-- longer a record nobody meant to make.

-- ------------------------------------------------- the sync, on a move too --
-- The expense trigger only ever recalculated the vehicle named on the row it
-- was handed, so moving an expense from one car to another updated the car it
-- arrived at and left the one it came from carrying a cost it no longer has.
-- Nothing moved expenses between cars before, so nothing had shown it up.

create or replace function car_vehicle_expense_sync()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  update car_vehicles v
     set expense_cost = coalesce((select sum(e.amount) from car_vehicle_expenses e
                                   where e.vehicle_id = v.id), 0)
   where v.id in (new.vehicle_id, old.vehicle_id);
  return coalesce(new, old);
end $function$;

-- ---------------------------------------------------------- the repair -----
do $$
declare
  r record; v_real uuid; v_moved int; v_gone int := 0; v_kept int := 0;
begin
  for r in
    with recursive po as (
      select d.id, d.company_id, d.doc_no from trade_documents d
      where d.doc_type = 'purchase_order' and is_car_cost_center(d.cost_center)
    ),
    chain as (
      select p.id as po_id, p.id as doc_id, 0 as depth from po p
      union all
      select c.po_id, t.id, c.depth + 1 from chain c
      join trade_documents t on t.source_doc_id = c.doc_id where c.depth < 10
    ),
    pv as (
      select distinct c.po_id, t.id as pv_id from chain c
      join trade_documents t on t.id = c.doc_id where t.doc_type = 'purchase_voucher'
    ),
    -- an ordered vehicle, the order it names, and what that order has received
    ph as (
      select v.id as vehicle_id, v.vehicle_no, v.company_id, p.id as po_id, p.doc_no,
             l.product_id,
             (select coalesce(sum(greatest(round(coalesce(l2.quantity,1))::int,1)), 0)
                from trade_document_lines l2
               where l2.doc_id = p.id and l2.product_id is not distinct from l.product_id) as ordered_qty,
             (select count(*) from car_vehicles v2
                join pv on pv.pv_id = v2.source_trade_doc
               where pv.po_id = p.id and v2.company_id = v.company_id
                 and v2.source_product_id is not distinct from l.product_id) as received_qty,
             -- the car that actually arrived on this order, for this item
             (select v2.id from car_vehicles v2
                join pv on pv.pv_id = v2.source_trade_doc
               where pv.po_id = p.id and v2.company_id = v.company_id
                 and v2.source_product_id is not distinct from l.product_id
               order by v2.created_at limit 1) as real_vehicle_id
      from car_vehicles v
      join trade_document_lines l on l.id = v.source_doc_line
      join po p on p.id = l.doc_id
      where v.status = 'ordered' and v.source_trade_doc is null
    )
    select * from ph where received_qty >= ordered_qty and ordered_qty > 0
  loop
    -- Anything but expenses means somebody has used this record for real.
    if exists (select 1 from car_contracts where vehicle_id = r.vehicle_id)
    or exists (select 1 from car_deliveries where vehicle_id = r.vehicle_id)
    or exists (select 1 from car_holdings where vehicle_id = r.vehicle_id)
    or exists (select 1 from car_transfers where vehicle_id = r.vehicle_id)
    or exists (select 1 from car_service_charges where vehicle_id = r.vehicle_id)
    or exists (select 1 from car_purchase_order_items where vehicle_id = r.vehicle_id) then
      v_kept := v_kept + 1;
      raise notice 'Left % alone — it is spoken for by more than expenses.', r.vehicle_no;
      continue;
    end if;

    v_real := r.real_vehicle_id;

    if v_real is null then
      v_kept := v_kept + 1;
      raise notice 'Left % alone — could not identify the car that arrived.', r.vehicle_no;
      continue;
    end if;

    update car_vehicle_expenses set vehicle_id = v_real where vehicle_id = r.vehicle_id;
    get diagnostics v_moved = row_count;

    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (r.company_id, null, 'car_vehicle_phantom_removed', 'car_vehicle', r.vehicle_id,
            jsonb_build_object('vehicle_no', r.vehicle_no, 'purchase_order', r.doc_no,
                               'expenses_moved_to', v_real, 'expenses_moved', v_moved,
                               'why', 'duplicate ordered record left by the car expense vehicle list'));

    delete from car_vehicles where id = r.vehicle_id;
    v_gone := v_gone + 1;
    raise notice 'Removed % (order %), % expense(s) moved to the car that arrived.',
      r.vehicle_no, r.doc_no, v_moved;
  end loop;

  raise notice 'Phantom ordered vehicles: % removed, % left alone.', v_gone, v_kept;
end $$;
