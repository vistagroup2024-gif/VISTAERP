-- Car Expense's vehicle picker showed a bare vehicle number — "CAR-000006" —
-- for any car with no make/model typed on it yet, which is most of a car
-- still on or just off a purchase order. There was nothing on the picker, the
-- landing page's "Vehicles with expenses" list, or the sheet itself to say
-- WHICH car that number actually is: not its item, not who it was bought
-- from, not which Purchase Order or Purchase Voucher raised it.
--
-- Both of car_expense_vehicle_options()'s two branches already know this —
-- the vehicle carries product_id/source_product_id, supplier_id, and either
-- source_trade_doc (bought straight off a Purchase Voucher, migration 259) or
-- source_doc_line (put on order by a Purchase Order line, migration 328) —
-- it was simply never read. `src` resolves whichever of the two the vehicle
-- actually has, the same "through anything switched off" shape
-- workflow_source_type() uses for the document chain generally: one column
-- reads either kind of origin without the caller needing to know which.
--
-- Also carries cost_center/tag_area now (car_cost_center()/car_tag_area(),
-- already defined in 330) — asked for directly, and the same reason every
-- car posting stamps one: a car expense's ledger entry already carries a tag
-- area, so the screen that raises it should say which one out loud.

create or replace function car_expense_vehicle_options()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with recursive co as (select auth_company_id() as id),

  -- Car purchase orders still open enough to be receiving cars.
  po as (
    select d.id, d.doc_no, d.doc_date, d.created_at, d.party_id
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
        'item', pr.name,
        'supplier', sup.name,
        'source', src.doc_no,
        'cost_center', car_cost_center(v.id),
        'tag_area', car_tag_area(v.id),
        'grp', case when v.status = 'ordered' then '1 On order' else '0 In the yard' end) as x
    from car_vehicles v
    left join acct_products pr on pr.id = coalesce(v.product_id, v.source_product_id)
    left join parties sup on sup.id = v.supplier_id
    left join trade_documents src on src.id = coalesce(
      v.source_trade_doc,
      (select l.doc_id from trade_document_lines l where l.id = v.source_doc_line))
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
        'item', nullif(coalesce(nullif(o.item_name,''), p.name), ''),
        'supplier', sup2.name,
        'source', d.doc_no,
        'cost_center', null,
        'tag_area', null,
        'grp', '1 On order') as x
    from outstanding o
    join po d on d.id = o.doc_id
    left join acct_products p on p.id = o.product_id
    left join parties sup2 on sup2.id = d.party_id
    where o.remaining > 0
  ) s
  where is_staff();
$function$;

-- car_expense_vehicle_summary() picks up the same fields, so a vehicle that
-- has already moved into "Vehicles with expenses" stays traceable too.

create or replace function car_expense_vehicle_summary()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x order by last_date desc), '[]'::jsonb) from (
    select
      jsonb_build_object(
        'vehicle_id', v.id,
        'label', concat_ws(' · ',
                   coalesce(nullif(concat_ws(' ', v.make, v.model, v.model_year::text), ''), pr.name),
                   coalesce(v.plate_no, v.vehicle_no)),
        'status', v.status::text,
        'cost', coalesce(v.total_cost, 0),
        'item', pr.name,
        'supplier', sup.name,
        'source', src.doc_no,
        'cost_center', car_cost_center(v.id),
        'tag_area', car_tag_area(v.id),
        'count', s.n,
        'total', s.amt,
        'last_date', s.last_date) as x,
      s.last_date
    from (
      select vehicle_id, count(*) as n, sum(amount) as amt, max(expense_date) as last_date
      from car_vehicle_expenses
      where company_id = auth_company_id()
      group by vehicle_id
    ) s
    join car_vehicles v on v.id = s.vehicle_id
    left join acct_products pr on pr.id = coalesce(v.product_id, v.source_product_id)
    left join parties sup on sup.id = v.supplier_id
    left join trade_documents src on src.id = coalesce(
      v.source_trade_doc,
      (select l.doc_id from trade_document_lines l where l.id = v.source_doc_line))
  ) t
  where is_staff();
$function$;

revoke all on function car_expense_vehicle_options() from public, anon;
revoke all on function car_expense_vehicle_summary() from public, anon;
grant execute on function car_expense_vehicle_options() to authenticated;
grant execute on function car_expense_vehicle_summary() to authenticated;
