-- Restores the prior, narrower shape of both functions (no item/supplier/
-- source/cost_center/tag_area fields). Copied from migrations 328 and 457.

create or replace function car_expense_vehicle_options()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with recursive co as (select auth_company_id() as id),

  po as (
    select d.id, d.doc_no, d.doc_date, d.created_at
    from trade_documents d, co
    where d.company_id = co.id
      and d.doc_type = 'purchase_order'
      and is_car_cost_center(d.cost_center)
      and coalesce(d.status,'open') not in ('cancelled','closed')
  ),

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
  ) t
  where is_staff();
$function$;

revoke all on function car_expense_vehicle_options() from public, anon;
revoke all on function car_expense_vehicle_summary() from public, anon;
grant execute on function car_expense_vehicle_options() to authenticated;
grant execute on function car_expense_vehicle_summary() to authenticated;
