-- A car expense can be booked before the car arrives.
--
-- The Car Expense voucher could only name a vehicle that already existed, and a
-- vehicle only comes into existence when the PURCHASE VOUCHER posts. But the
-- expenses do not wait for the car: customs, clearing and transport are billed
-- while it is still on order. So the one voucher meant to catch those costs
-- could not be raised until after the moment most of them arrive, and they went
-- back to being remembered on paper.
--
-- A car on a purchase ORDER now shows in the vehicle list too. Picking one
-- creates its vehicle record there and then, with status `ordered` — which is
-- what that status was always for, and which holds no stock and posts no
-- purchase, because neither has happened yet. The expense attaches to it
-- normally and capitalises as it always did.
--
-- WHEN THE CAR ACTUALLY ARRIVES, THE PURCHASE VOUCHER ADOPTS IT. That is the
-- whole risk of this change and it is where the care goes: create a vehicle at
-- order time and let the PV create another, and every ordered car ends up twice
-- in the yard with its expenses on the dead one. car_vehicle_from_trade_doc now
-- looks for ordered vehicles belonging to a purchase order UPSTREAM of the
-- voucher, matched on the item, and fills those in rather than inserting. Only
-- once it runs out does it insert. (This is the same shape as acct_create
-- adopting the account its trigger raised, and for the same reason.)
--
-- Vehicles already in the yard are untouched: they are not `ordered`, so no
-- adoption can claim them.

-- --------------------------------------------------- a car that is on order --

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

-- ------------------------------------------------------- what the list shows --
-- One list for the screen: the cars in the yard, and the cars still on order
-- that nothing has made a record for yet.

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

-- ------------------------------------------------------------ the voucher ----
-- Same routine, one new way in: a purchase order line instead of a vehicle.

create or replace function car_expense_save(p_id uuid, p_header jsonb)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid; v_veh uuid; v_amt numeric; v_date date;
  v_head uuid; v_name text; v_credit uuid; v_inv uuid; v_posted jsonb;
  v_entry uuid; v_no text; v_old uuid; v_line uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform car_ensure_accounts(v_co);

  v_veh  := nullif(p_header->>'vehicle_id','')::uuid;
  v_line := nullif(p_header->>'po_line_id','')::uuid;
  v_amt  := coalesce(nullif(p_header->>'amount','')::numeric, 0);
  v_date := coalesce(nullif(p_header->>'expense_date','')::date, current_date);
  v_head := nullif(p_header->>'expense_id','')::uuid;
  v_name := nullif(btrim(coalesce(p_header->>'expense_name','')),'');
  v_credit := nullif(p_header->>'credit_account','')::uuid;

  -- A car still on order has no vehicle record yet. Make it, then carry on
  -- exactly as before — the expense knows nothing about how it got here.
  if v_veh is null and v_line is not null then
    v_veh := car_vehicle_ensure_ordered(v_line);
  end if;

  if v_veh is null then raise exception 'Choose the vehicle'; end if;
  if v_amt <= 0 then raise exception 'Enter an amount'; end if;
  if v_name is null and v_head is not null then
    select name into v_name from acct_car_purchase_expenses where id = v_head;
  end if;
  if v_name is null then raise exception 'Choose the expense head'; end if;
  if not exists (select 1 from car_vehicles where id = v_veh and company_id = v_co) then
    raise exception 'Vehicle not found';
  end if;

  select id into v_inv from accounts where company_id = v_co and code = '1160';
  if v_credit is null then select id into v_credit from accounts where company_id = v_co and code = '2100'; end if;
  if v_inv is null or v_credit is null then raise exception 'Vehicle accounts are missing — seed the chart first'; end if;

  if p_id is not null then
    select entry_id into v_old from car_vehicle_expenses where id = p_id and company_id = v_co;
    if v_old is not null then
      update car_vehicle_expenses set entry_id = null where id = p_id;
      perform car_expense_unpost(v_old);
    end if;
  end if;

  -- The vehicle is DEBITED (the cost lands on the car) and the vendor is
  -- CREDITED (we owe them, or the bank paid them). That has always been the way
  -- round; the field on the screen was just named after the wrong side.
  v_posted := gl_post(v_co, v_date,
    'Car expense — ' || v_name, 'car_expense', 'car_expense', nullif(p_header->>'reference',''),
    jsonb_build_array(
      jsonb_build_object('account_id', v_inv::text,    'debit', v_amt, 'credit', 0),
      jsonb_build_object('account_id', v_credit::text, 'debit', 0,     'credit', v_amt)));
  v_entry := (v_posted->>'entry_id')::uuid;
  v_no    := v_posted->>'entry_no';

  if p_id is null then
    insert into car_vehicle_expenses(company_id, vehicle_id, expense_id, expense_name,
                                     expense_date, amount, narration, reference, entry_id, created_by)
    values (v_co, v_veh, v_head, v_name, v_date, v_amt,
            nullif(p_header->>'narration',''), v_no, v_entry, auth.uid())
    returning id into v_id;
  else
    update car_vehicle_expenses set
      vehicle_id = v_veh, expense_id = v_head, expense_name = v_name, expense_date = v_date,
      amount = v_amt, narration = nullif(p_header->>'narration',''), reference = v_no, entry_id = v_entry
    where id = p_id and company_id = v_co
    returning id into v_id;
    if v_id is null then raise exception 'Car expense not found'; end if;
  end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), case when p_id is null then 'car_expense_created' else 'car_expense_updated' end,
          'car_vehicle_expense', v_id, jsonb_build_object('vehicle', v_veh, 'head', v_name, 'amount', v_amt));
  return v_id;
end $function$;

revoke all on function car_expense_save(uuid, jsonb) from public, anon;
grant execute on function car_expense_save(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ the adoption ---
-- The Purchase Voucher fills in the cars it ordered rather than making new ones.

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

  -- The documents this voucher came from, so an ordered car can be recognised
  -- as THIS voucher's rather than some other purchase order's.
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

    -- The voucher total carries the landed cost, so split THAT between the
    -- lines — by what each line is worth, not by how many units it holds. The
    -- last line takes whatever is left, so the split is exact.
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
    v_left := v_share - v_unit * (v_units - 1);   -- the last unit absorbs the rest

    for k in (v_have + 1)..v_units loop
      v_cost := case when k = v_units then v_left else v_unit end;

      -- Was this car already put on order? Then fill that record in instead of
      -- making a second one — its expenses are already attached to it.
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
