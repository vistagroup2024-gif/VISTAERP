-- Restores car_vehicle_ensure_ordered, car_vehicle_from_trade_doc, car_tag_area
-- and car_vehicle_save to their pre-462 shape (copied from migrations 328,
-- 322, 330, 274), and drops the column they wrote to.

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

  select id into v_id from car_vehicles
   where company_id = v_co and source_doc_line = p_line
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;

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

create or replace function car_vehicle_from_trade_doc(p_doc uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare d trade_documents; v_cc text; v_id uuid; v_first uuid; v_no text;
        ln record; v_units int; v_have int; v_share numeric; v_unit numeric;
        v_lines_qty numeric; v_lines_amt numeric; v_total numeric;
        v_line_n int := 0; v_lines int; v_alloc numeric := 0; v_left numeric; k int;
        v_ancestors uuid[]; v_walk uuid; i int; v_adopt uuid; v_cost numeric;
begin
  select * into d from trade_documents where id = p_doc;
  if not found then return null; end if;
  if d.doc_type <> 'purchase_voucher' then return null; end if;
  v_cc := upper(btrim(coalesce(d.cost_center, '')));
  if v_cc not in ('CAR SALES INSTALLMENT', 'CAR TRADING') then return null; end if;

  v_ancestors := array[]::uuid[];
  v_walk := d.source_doc_id; i := 0;
  while v_walk is not null and i < 10 loop
    i := i + 1;
    v_ancestors := v_ancestors || v_walk;
    select source_doc_id into v_walk from trade_documents where id = v_walk;
  end loop;

  v_total := coalesce(d.total, 0);
  select coalesce(sum(greatest(round(coalesce(l.quantity, 1)), 1)), 0),
         coalesce(sum(coalesce(l.amount, 0)), 0), count(*)
    into v_lines_qty, v_lines_amt, v_lines
    from trade_document_lines l where l.doc_id = p_doc;

  if v_lines_qty = 0 then
    select id into v_id from car_vehicles where source_trade_doc = p_doc limit 1;
    if v_id is not null then return v_id; end if;
    v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
    insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
      ownership, is_trading, status, notes, source_trade_doc)
    values (d.company_id, v_no, d.party_id, d.doc_date, v_total,
      'vista', v_cc = 'CAR TRADING', 'in_stock',
      'Created from Purchase Voucher ' || coalesce(d.doc_no, ''), p_doc)
    returning id into v_id;
    return v_id;
  end if;

  for ln in select l.id, l.product_id, l.quantity, l.amount
            from trade_document_lines l where l.doc_id = p_doc order by l.sort, l.id loop
    v_line_n := v_line_n + 1;
    v_units := greatest(round(coalesce(ln.quantity, 1))::int, 1);

    if v_line_n = v_lines then
      v_share := v_total - v_alloc;
    elsif v_lines_amt > 0 then
      v_share := round(v_total * (coalesce(ln.amount, 0) / v_lines_amt), 2);
    else
      v_share := round(v_total * (v_units::numeric / v_lines_qty), 2);
    end if;
    v_alloc := v_alloc + v_share;

    select count(*) into v_have from car_vehicles where source_doc_line = ln.id;
    v_unit := round(v_share / v_units, 2);
    v_left := v_share - v_unit * (v_units - 1);

    for k in (v_have + 1)..v_units loop
      v_cost := case when k = v_units then v_left else v_unit end;

      select v2.id into v_adopt
      from car_vehicles v2
      join trade_document_lines pl on pl.id = v2.source_doc_line
      where v2.company_id = d.company_id
        and v2.status = 'ordered'
        and v2.source_trade_doc is null
        and v2.source_product_id is not distinct from ln.product_id
        and pl.doc_id = any (v_ancestors)
      order by v2.created_at
      limit 1;

      if v_adopt is not null then
        update car_vehicles set
          supplier_id      = coalesce(d.party_id, supplier_id),
          purchase_date    = d.doc_date,
          purchase_cost    = v_cost,
          is_trading       = (v_cc = 'CAR TRADING'),
          status           = 'in_stock',
          notes            = 'Ordered, then received on Purchase Voucher ' || coalesce(d.doc_no, ''),
          source_trade_doc = p_doc,
          source_doc_line  = ln.id,
          updated_at       = now()
        where id = v_adopt;
        v_id := v_adopt;
      else
        v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
        insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
          ownership, is_trading, status, notes, source_trade_doc, source_doc_line, source_product_id)
        values (d.company_id, v_no, d.party_id, d.doc_date, v_cost,
          'vista', v_cc = 'CAR TRADING', 'in_stock',
          'Created from Purchase Voucher ' || coalesce(d.doc_no, ''), p_doc, ln.id, ln.product_id)
        returning id into v_id;
      end if;

      if v_first is null then v_first := v_id; end if;
    end loop;
  end loop;

  if v_first is null then select id into v_first from car_vehicles where source_trade_doc = p_doc limit 1; end if;
  return v_first;
end $function$;

create or replace function car_tag_area(p_vehicle uuid)
returns text language sql stable security definer set search_path to 'public'
as $function$
  select nullif(btrim(c.tag_area), '') from car_contracts c
   where c.vehicle_id = p_vehicle and c.status in ('draft','active','completed')
   order by c.created_at desc limit 1;
$function$;

create or replace function public.car_vehicle_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_id uuid; v_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then
    v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
    insert into car_vehicles(company_id, vehicle_no, created_by) values (v_company, v_no, auth.uid())
      returning id into v_id;
  else
    v_id := p_id;
  end if;

  update car_vehicles set
    product_id    = nullif(p->>'product_id','')::uuid,
    vin           = nullif(p->>'vin',''),
    plate_no      = nullif(p->>'plate_no',''),
    make          = nullif(p->>'make',''),
    model         = nullif(p->>'model',''),
    variant       = nullif(p->>'variant',''),
    model_year    = nullif(p->>'model_year','')::int,
    color         = nullif(p->>'color',''),
    engine_no     = nullif(p->>'engine_no',''),
    purchase_date = nullif(p->>'purchase_date','')::date,
    supplier_id   = nullif(p->>'supplier_id','')::uuid,
    purchase_cost = coalesce(nullif(p->>'purchase_cost','')::numeric, 0),
    purchase_vat  = coalesce(nullif(p->>'purchase_vat','')::numeric, 0),
    current_location = nullif(p->>'current_location',''),
    status        = coalesce(nullif(p->>'status','')::car_vehicle_status, status),
    ownership     = coalesce(nullif(p->>'ownership','')::car_ownership_status, ownership),
    notes         = nullif(p->>'notes',''),
    updated_at    = now()
  where id = v_id and company_id = v_company;

  return v_id;
end $$;
revoke all on function public.car_vehicle_save(uuid, jsonb) from anon;
grant execute on function public.car_vehicle_save(uuid, jsonb) to authenticated;

alter table car_vehicles drop column if exists tag_area;
