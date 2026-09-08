-- ROLLBACK for 322_car_expense_before_the_car.sql.
--
-- The Car Expense voucher goes back to naming only a vehicle that already
-- exists, and the Purchase Voucher goes back to always inserting.
--
-- READ THIS BEFORE RUNNING IT. Vehicles created at ORDER time are not deleted —
-- they are real records with real expenses capitalised onto them, and throwing
-- them away would throw the expenses' attribution away with them. But once the
-- adoption is gone, the Purchase Voucher that receives those cars will INSERT
-- alongside them, and the yard will hold each ordered car twice. So check:
--
--     select v.vehicle_no, v.status, v.purchase_cost
--       from car_vehicles v
--      where v.status = 'ordered' and v.source_trade_doc is null;
--
-- An empty result means this is a clean reversal. Otherwise, either receive
-- those cars first (while 322 is still in place, so they are adopted), or
-- cancel the ordered records and re-book their expenses against the real
-- vehicles afterwards.

drop function if exists car_expense_vehicle_options();
drop function if exists car_vehicle_ensure_ordered(uuid);

create or replace function car_expense_save(p_id uuid, p_header jsonb)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid; v_veh uuid; v_amt numeric; v_date date;
  v_head uuid; v_name text; v_credit uuid; v_inv uuid; v_posted jsonb;
  v_entry uuid; v_no text; v_old uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform car_ensure_accounts(v_co);

  v_veh  := nullif(p_header->>'vehicle_id','')::uuid;
  v_amt  := coalesce(nullif(p_header->>'amount','')::numeric, 0);
  v_date := coalesce(nullif(p_header->>'expense_date','')::date, current_date);
  v_head := nullif(p_header->>'expense_id','')::uuid;
  v_name := nullif(btrim(coalesce(p_header->>'expense_name','')),'');
  v_credit := nullif(p_header->>'credit_account','')::uuid;

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

create or replace function car_vehicle_from_trade_doc(p_doc uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare d trade_documents; v_cc text; v_id uuid; v_first uuid; v_no text;
        ln record; v_units int; v_have int; v_share numeric; v_unit numeric;
        v_lines_qty numeric; v_lines_amt numeric; v_total numeric;
        v_line_n int := 0; v_lines int; v_alloc numeric := 0; v_left numeric; k int;
begin
  select * into d from trade_documents where id = p_doc;
  if not found then return null; end if;
  if d.doc_type <> 'purchase_voucher' then return null; end if;
  v_cc := upper(btrim(coalesce(d.cost_center, '')));
  if v_cc not in ('CAR SALES INSTALLMENT', 'CAR TRADING') then return null; end if;

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
      v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
      insert into car_vehicles(company_id, vehicle_no, supplier_id, purchase_date, purchase_cost,
        ownership, is_trading, status, notes, source_trade_doc, source_doc_line, source_product_id)
      values (d.company_id, v_no, d.party_id, d.doc_date,
        case when k = v_units then v_left else v_unit end,
        'vista', v_cc = 'CAR TRADING', 'in_stock',
        'Created from Purchase Voucher ' || coalesce(d.doc_no, ''), p_doc, ln.id, ln.product_id)
      returning id into v_id;
      if v_first is null then v_first := v_id; end if;
    end loop;
  end loop;

  if v_first is null then select id into v_first from car_vehicles where source_trade_doc = p_doc limit 1; end if;
  return v_first;
end $function$;
