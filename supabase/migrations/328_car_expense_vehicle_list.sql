-- The car expense vehicle list showed the same car twice.
--
-- 322 offered a car that was still on a Purchase Order, and excluded a PO line
-- once a vehicle record pointed at it. That guard only ever caught the records
-- car_vehicle_ensure_ordered makes, because those are the only ones whose
-- source_doc_line is the PURCHASE ORDER's line.
--
-- When the car actually arrives, car_vehicle_from_trade_doc adopts that record
-- and re-points source_doc_line at the PURCHASE VOUCHER's line. The PO line is
-- then spoken for by nothing, so it came back into the list — and the car
-- appeared twice: once in the yard, and once still on order. A car the PV
-- created outright, with no ordered record to adopt, did the same.
--
-- A purchase order line is now measured against every car that came out of it,
-- however it was made: a record made at order time (source_doc_line = the PO
-- line), or a car from any Purchase Voucher raised DOWNSTREAM of that order for
-- the same item. The line is offered only while the order still has cars
-- nobody has made a record for, and a multi-car line says how many of it are
-- still to come.
--
-- So the list reads the way the yard does: a car that has been received is a
-- purchase-voucher car, and only what is still genuinely on order shows as on
-- order.
--
-- Newest first, as well. The list was alphabetical, which put a car bought two
-- years ago above the one that arrived this morning.

create or replace function car_expense_vehicle_options()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with recursive co as (select auth_company_id() as id),

  -- Car purchase orders still open enough to be receiving cars.
  po as (
    select d.id, d.doc_no, d.doc_date, d.created_at
    from trade_documents d, co
    where d.company_id = co.id
      and d.doc_type = 'purchase_order'
      and is_car_cost_center(d.cost_center)
      and coalesce(d.status,'open') not in ('cancelled','closed')
  ),

  -- Everything raised downstream of each order, to any depth: a Purchase
  -- Voucher may sit behind a Material Receipt Note rather than on the order
  -- itself. The depth bound is the same one car_vehicle_from_trade_doc walks.
  chain as (
    select p.id as po_id, p.id as doc_id, 0 as depth from po p
    union all
    select c.po_id, t.id, c.depth + 1
    from chain c
    join trade_documents t on t.source_doc_id = c.doc_id
    where c.depth < 10
  ),
  pv as (
    select distinct c.po_id, t.id as pv_id
    from chain c
    join trade_documents t on t.id = c.doc_id
    where t.doc_type = 'purchase_voucher'
  ),

  po_line as (
    select l.id, l.doc_id, l.product_id, l.item_name, l.sort,
           greatest(round(coalesce(l.quantity, 1))::int, 1) as qty
    from trade_document_lines l
    join po p on p.id = l.doc_id
  ),

  -- How many cars this order has actually produced for this item. Counted per
  -- (order, item) rather than per line, so two lines of the same car on one
  -- order cannot each claim the same vehicle.
  made as (
    select k.doc_id, k.product_id,
      (select count(*) from car_vehicles v
        where v.source_doc_line in (
                select pl2.id from po_line pl2
                 where pl2.doc_id = k.doc_id
                   and pl2.product_id is not distinct from k.product_id))
      +
      (select count(*) from car_vehicles v
         join pv on pv.pv_id = v.source_trade_doc
        where pv.po_id = k.doc_id
          and v.source_product_id is not distinct from k.product_id) as n
    from (select distinct doc_id, product_id from po_line) k
  ),

  -- Spread that count over the order's lines in order, so the first line is
  -- filled before the second.
  outstanding as (
    select pl.id, pl.doc_id, pl.item_name, pl.product_id, pl.qty,
           greatest(least(pl.qty,
             sum(pl.qty) over (partition by pl.doc_id, pl.product_id
                               order by pl.sort, pl.id
                               rows between unbounded preceding and current row) - m.n), 0) as remaining
    from po_line pl
    join made m on m.doc_id = pl.doc_id
               and m.product_id is not distinct from pl.product_id
  )

  select coalesce(jsonb_agg(x order by grp, ord desc nulls last, label), '[]'::jsonb) from (

    -- In the yard, or on order with a record already made.
    select
      case when v.status = 'ordered' then '1 On order' else '0 In the yard' end as grp,
      coalesce(v.created_at, v.purchase_date::timestamptz) as ord,
      concat_ws(' · ',
        coalesce(nullif(concat_ws(' ', v.make, v.model, v.model_year::text), ''), pr.name),
        coalesce(v.plate_no, v.vehicle_no)) as label,
      jsonb_build_object(
        'kind', 'vehicle', 'id', v.id, 'po_line', null,
        'label', concat_ws(' · ',
                   coalesce(nullif(concat_ws(' ', v.make, v.model, v.model_year::text), ''), pr.name),
                   coalesce(v.plate_no, v.vehicle_no)),
        'cost', coalesce(v.total_cost, 0),
        'status', v.status::text,
        'grp', case when v.status = 'ordered' then '1 On order' else '0 In the yard' end) as x
    from car_vehicles v
    left join acct_products pr on pr.id = coalesce(v.product_id, v.source_product_id)
    , co
    where v.company_id = co.id and v.status not in ('cancelled')

    union all

    -- Still on order and nothing made for it yet. Picking one makes it.
    select
      '1 On order' as grp,
      coalesce(d.created_at, d.doc_date::timestamptz) as ord,
      concat_ws(' · ', coalesce(nullif(o.item_name,''), p.name, 'Vehicle'), 'on ' || d.doc_no) as label,
      jsonb_build_object(
        'kind', 'po_line', 'id', null, 'po_line', o.id,
        'label', concat_ws(' · ', coalesce(nullif(o.item_name,''), p.name, 'Vehicle'),
                           'on ' || d.doc_no)
                 || case when o.qty > 1
                         then ' (' || o.remaining || ' of ' || o.qty || ' not yet received)'
                         else '' end,
        'cost', 0,
        'status', 'on_order',
        'grp', '1 On order') as x
    from outstanding o
    join po d on d.id = o.doc_id
    left join acct_products p on p.id = o.product_id
    where o.remaining > 0
  ) s
  where is_staff();
$function$;

revoke all on function car_expense_vehicle_options() from public, anon;
grant execute on function car_expense_vehicle_options() to authenticated;

-- ---------------------------------------------------- and the door as well ---
-- The list is a picker, and a picker only decides what is offered. The routine
-- behind it takes whatever line id is sent to it, so it makes the same count
-- and refuses a line whose cars have already arrived — otherwise a stale screen
-- left open across the purchase voucher would still mint the duplicate.

create or replace function car_vehicle_ensure_ordered(p_line uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id();
  ln   trade_document_lines;
  d    trade_documents;
  v_id uuid; v_no text; v_qty int; v_made int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  select * into ln from trade_document_lines where id = p_line;
  if not found then raise exception 'That purchase order line is gone.'; end if;
  select * into d from trade_documents where id = ln.doc_id and company_id = v_co;
  if not found then raise exception 'That purchase order is not in this company.'; end if;
  if d.doc_type <> 'purchase_order' then
    raise exception 'A car is put on order by a Purchase Order, not by a %.', d.doc_type;
  end if;
  if not is_car_cost_center(d.cost_center) then
    raise exception '% is not in a car cost centre.', d.doc_no;
  end if;

  -- Already made, whether by this routine or by the purchase voucher.
  select id into v_id from car_vehicles
   where company_id = v_co and source_doc_line = p_line
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  -- How many cars this order has already produced for this item, counting both
  -- the ones put on order here and the ones a downstream Purchase Voucher made.
  with recursive chain as (
    select d.id as doc_id, 0 as depth
    union all
    select t.id, c.depth + 1
    from chain c join trade_documents t on t.source_doc_id = c.doc_id
    where c.depth < 10
  ),
  pv as (
    select distinct t.id as pv_id from chain c
    join trade_documents t on t.id = c.doc_id
    where t.doc_type = 'purchase_voucher'
  ),
  po_line as (
    select l.id from trade_document_lines l
    where l.doc_id = d.id and l.product_id is not distinct from ln.product_id
  )
  select coalesce(sum(greatest(round(coalesce(l.quantity, 1))::int, 1)), 0),
         (select count(*) from car_vehicles v where v.company_id = v_co
            and v.source_doc_line in (select id from po_line))
       + (select count(*) from car_vehicles v join pv on pv.pv_id = v.source_trade_doc
           where v.company_id = v_co and v.source_product_id is not distinct from ln.product_id)
    into v_qty, v_made
  from trade_document_lines l
  where l.doc_id = d.id and l.product_id is not distinct from ln.product_id;

  if v_made >= v_qty then
    raise exception 'Every car ordered on % has already been received — pick it from the yard instead.', d.doc_no;
  end if;

  v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
  insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
    ownership, is_trading, status, notes, source_doc_line, source_product_id)
  values (v_co, v_no, d.party_id, d.doc_date, 0,
    'vista', upper(btrim(coalesce(d.cost_center,''))) = 'CAR TRADING', 'ordered',
    'On order against Purchase Order ' || coalesce(d.doc_no, ''), p_line, ln.product_id)
  returning id into v_id;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'car_vehicle_ordered', 'car_vehicle', v_id,
          jsonb_build_object('vehicle_no', v_no, 'purchase_order', d.doc_no, 'line', p_line));
  return v_id;
end $function$;

revoke all on function car_vehicle_ensure_ordered(uuid) from public, anon;
grant execute on function car_vehicle_ensure_ordered(uuid) to authenticated;
