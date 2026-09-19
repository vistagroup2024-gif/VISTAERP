-- car_tag_area() only ever read a tag area off the SALE (car_contracts.tag_area,
-- typed on the Car Invoice) — so a car that hasn't been sold yet had none, and
-- every car expense booked before the sale (registration, insurance, customs —
-- exactly when most of them land, per "A car expense reaches the stock ledger
-- as well as the GL" above) posted with tag_area = NULL. Not a display bug:
-- car_expense_save, car_post_charge, car_post_charge_payment, car_post_commission
-- and car_post_receipt all read the same one function, so the gap was in every
-- one of those postings, not just the screen that started showing it.
--
-- The Purchase Voucher already asks for a tag area, per line
-- (cfg.tagAreaInLine on Purchase Voucher, TradeVoucher.tsx) — captured into
-- trade_document_lines.meta.tag_area on save, and until now read by nothing.
-- A car bought on a Purchase Voucher already has this typed, one line per
-- car; it was just never carried onto the vehicle it bought.
--
-- car_vehicles.tag_area is that carry: car_vehicle_from_trade_doc (a car
-- adopted from an order, or made outright by a Purchase Voucher) and
-- car_vehicle_ensure_ordered (a car still on a Purchase Order, put there
-- before it is even received) both copy their line's meta.tag_area onto the
-- vehicle now. car_tag_area() falls back to it whenever the sale hasn't set
-- one yet — the same shape car_cost_center() already uses (the contract's own
-- value first, a fallback under it), just with a real stored fallback instead
-- of a computed one, because unlike cost centre a tag area has no sensible
-- default to compute.
--
-- car_vehicle_save() (the Vehicles → Edit screen) also takes it now, so a car
-- bought before this migration — or one whose Purchase Voucher line never had
-- a tag area typed on it — can still have one set directly, the same as any
-- other field on that form. That screen is master data the user corrects
-- directly, not something only inferred at purchase time.

alter table car_vehicles add column if not exists tag_area text;

-- ── put on order: the PO line's own tag area, if it has one ──────────────

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
    ownership, is_trading, status, notes, source_doc_line, source_product_id, tag_area)
  values (v_co, v_no, d.party_id, d.doc_date, 0,
    'vista', upper(btrim(coalesce(d.cost_center,''))) = 'CAR TRADING', 'ordered',
    'On order against Purchase Order ' || coalesce(d.doc_no, ''), p_line, ln.product_id,
    nullif(btrim(coalesce(ln.meta->>'tag_area','')), ''))
  returning id into v_id;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'car_vehicle_ordered', 'car_vehicle', v_id,
          jsonb_build_object('vehicle_no', v_no, 'purchase_order', d.doc_no, 'line', p_line));
  return v_id;
end $function$;

revoke all on function car_vehicle_ensure_ordered(uuid) from public, anon;
grant execute on function car_vehicle_ensure_ordered(uuid) to authenticated;

-- ── received: the Purchase Voucher line's own tag area, if it has one ────
-- Takes it over the PO line's (the PV is what actually happened; the PO was
-- a plan) but keeps whatever is already there when the PV line has none, so
-- an ordered car does not lose the tag area it was put on order under.

create or replace function car_vehicle_from_trade_doc(p_doc uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare d trade_documents; v_cc text; v_id uuid; v_first uuid; v_no text;
        ln record; v_units int; v_have int; v_share numeric; v_unit numeric;
        v_lines_qty numeric; v_lines_amt numeric; v_total numeric;
        v_line_n int := 0; v_lines int; v_alloc numeric := 0; v_left numeric; k int;
        v_ancestors uuid[]; v_walk uuid; i int; v_adopt uuid; v_cost numeric; v_ta text;
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

  for ln in select l.id, l.product_id, l.quantity, l.amount, l.meta
            from trade_document_lines l where l.doc_id = p_doc order by l.sort, l.id loop
    v_line_n := v_line_n + 1;
    v_units := greatest(round(coalesce(ln.quantity, 1))::int, 1);
    v_ta := nullif(btrim(coalesce(ln.meta->>'tag_area','')), '');

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
          tag_area         = coalesce(v_ta, tag_area),
          updated_at       = now()
        where id = v_adopt;
        v_id := v_adopt;
      else
        v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
        insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
          ownership, is_trading, status, notes, source_trade_doc, source_doc_line, source_product_id, tag_area)
        values (d.company_id, v_no, d.party_id, d.doc_date, v_cost,
          'vista', v_cc = 'CAR TRADING', 'in_stock',
          'Created from Purchase Voucher ' || coalesce(d.doc_no, ''), p_doc, ln.id, ln.product_id, v_ta)
        returning id into v_id;
      end if;

      if v_first is null then v_first := v_id; end if;
    end loop;
  end loop;

  if v_first is null then select id into v_first from car_vehicles where source_trade_doc = p_doc limit 1; end if;
  return v_first;
end $function$;

-- ── the fallback itself ───────────────────────────────────────────────────

create or replace function car_tag_area(p_vehicle uuid)
returns text language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    (select nullif(btrim(c.tag_area), '') from car_contracts c
      where c.vehicle_id = p_vehicle and c.status in ('draft','active','completed')
      order by c.created_at desc limit 1),
    (select v.tag_area from car_vehicles v where v.id = p_vehicle));
$function$;

-- ── the Vehicles screen can set or fix it directly ────────────────────────

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
    tag_area      = nullif(p->>'tag_area',''),
    notes         = nullif(p->>'notes',''),
    updated_at    = now()
  where id = v_id and company_id = v_company;

  return v_id;
end $$;
revoke all on function public.car_vehicle_save(uuid, jsonb) from anon;
grant execute on function public.car_vehicle_save(uuid, jsonb) to authenticated;

-- ── catching up: every car already bought carries its own line's tag area ──
-- Only where the Purchase Order/Voucher line it came from actually had one
-- typed, and only where the vehicle doesn't already carry one — nothing is
-- overwritten, and a car with nothing on its line stays exactly as honest as
-- it was: no tag area, not a fabricated one.

update car_vehicles v
   set tag_area = nullif(btrim(l.meta->>'tag_area'), '')
  from trade_document_lines l
 where v.source_doc_line = l.id
   and v.tag_area is null
   and nullif(btrim(l.meta->>'tag_area'), '') is not null;
