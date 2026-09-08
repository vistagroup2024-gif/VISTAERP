-- Rollback 328: put back the 322 list (a received car shows twice, and the
-- order is alphabetical rather than newest first).

create or replace function car_expense_vehicle_options()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with co as (select auth_company_id() as id)
  select coalesce(jsonb_agg(x order by x->>'grp', x->>'label'), '[]'::jsonb) from (
    -- In the yard, or on order with a record already made.
    -- A car created by a Purchase Voucher has no make or model typed on it yet
    -- — the voucher only knows the ITEM it bought — so the item's name is the
    -- fallback before the plate number.
    select jsonb_build_object(
      'kind', 'vehicle', 'id', v.id, 'po_line', null,
      'label', concat_ws(' · ',
                 coalesce(nullif(concat_ws(' ', v.make, v.model, v.model_year::text), ''), pv.name),
                 coalesce(v.plate_no, v.vehicle_no)),
      'cost', coalesce(v.total_cost, 0),
      'status', v.status::text,
      'grp', case when v.status = 'ordered' then '1 On order' else '0 In the yard' end) as x
    from car_vehicles v
    left join acct_products pv on pv.id = coalesce(v.product_id, v.source_product_id)
    , co
    where v.company_id = co.id and v.status not in ('cancelled')

    union all

    -- On a car purchase order and no record made yet. Picking one makes it.
    select jsonb_build_object(
      'kind', 'po_line', 'id', null, 'po_line', l.id,
      'label', concat_ws(' · ', coalesce(nullif(l.item_name,''), p.name, 'Vehicle'),
                         'on ' || d.doc_no),
      'cost', 0,
      'status', 'on_order',
      'grp', '1 On order')
    from trade_documents d
    join trade_document_lines l on l.doc_id = d.id
    left join acct_products p on p.id = l.product_id
    , co
    where d.company_id = co.id
      and d.doc_type = 'purchase_order'
      and is_car_cost_center(d.cost_center)
      and coalesce(d.status,'open') not in ('cancelled','closed')
      and not exists (select 1 from car_vehicles v2 where v2.source_doc_line = l.id)
  ) s
  where is_staff();
$function$;

revoke all on function car_expense_vehicle_options() from public, anon;
grant execute on function car_expense_vehicle_options() to authenticated;


create or replace function car_vehicle_ensure_ordered(p_line uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id();
  ln   trade_document_lines;
  d    trade_documents;
  v_id uuid; v_no text;
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
