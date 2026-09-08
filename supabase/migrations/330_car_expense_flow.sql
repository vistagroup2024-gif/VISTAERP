-- The Car Expense voucher, gone over end to end.
--
-- Six things were wrong with it, and they are fixed here together because they
-- are all the same screen and the same posting.
--
-- 1. A COST BOOKED AFTER THE CAR INVOICE NEVER REACHED THE PROFIT. The invoice
--    copied the car's total cost once, when it was raised, and kept that number
--    for ever. Registration billed a week later raised the car's cost and left
--    the sale's COGS where it was — the margin on that car simply read too high,
--    with nothing to say so. The cost is live now: whenever an expense changes,
--    every open invoice on that car is brought to the car's current cost, and
--    the sale entry's Cost of Vehicles Sold / Vehicle Inventory pair moves with
--    it. The pair moves together, so the entry stays balanced.
--
-- 2. DELETING A CAR TOOK ITS EXPENSES AND LEFT THEIR POSTINGS. The expense rows
--    cascade with the vehicle, but their ledger entries do not — so the money
--    stayed in Vehicle Inventory with no car behind it. Reachable in one step:
--    unposting a car Purchase Voucher deletes the vehicles it created. A car
--    with expenses on it now refuses to be deleted, from every direction at
--    once, because the refusal is a trigger rather than a line in each routine.
--
-- 3. THE SCREEN HAD NO RIGHTS. Every other voucher can be granted per user —
--    open, create, edit, delete, print. This one had none, so anyone who could
--    see Car Sales could delete a car expense, and deleting voids a ledger
--    entry. It is a rights-managed screen now, checked at the routine and not
--    only at the button.
--
-- 4. NOTHING CARRIED A COST CENTRE. Transport, visa and sales all stamp theirs
--    on the ledger; the whole car module stamped none, so car money was
--    invisible in a cost-centre report. Every car posting carries it now, taken
--    from the Car Invoice where there is one — the user already types it there —
--    and otherwise from whether the car is trading stock.
--
-- 5. THE VENDOR LIST IGNORED ACCOUNT RESTRICTIONS. It was `security definer`,
--    so RLS never reached it and a restricted user was offered every payable,
--    cash and bank account. It is `security invoker` now, which is how the rest
--    of the read-only routines honour a restriction, and the account is checked
--    again on the way in — a picker only decides what is offered.
--
-- 6. THERE WAS NO EDIT. car_expense_save has always taken an id and done the
--    right thing with it (unpost, repost, update), but the screen never sent
--    one, so a typo meant delete and retype. The vendor was the one field that
--    could not be reloaded, because it lived only on the journal line; it is
--    stored on the expense now, backfilled from the postings.

-- ------------------------------------------------ where a car's money belongs --
-- The Car Invoice already carries the cost centre and tag area the user chose.
-- That is the best answer when there is one; a car with no invoice yet falls
-- back to what kind of stock it is.

create or replace function car_cost_center(p_vehicle uuid)
returns text language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    (select nullif(btrim(c.cost_center), '') from car_contracts c
      where c.vehicle_id = p_vehicle and c.status in ('draft','active','completed')
      order by c.created_at desc limit 1),
    (select case when v.is_trading then 'CAR TRADING' else 'CAR SALES INSTALLMENT' end
       from car_vehicles v where v.id = p_vehicle));
$function$;

create or replace function car_tag_area(p_vehicle uuid)
returns text language sql stable security definer set search_path to 'public'
as $function$
  select nullif(btrim(c.tag_area), '') from car_contracts c
   where c.vehicle_id = p_vehicle and c.status in ('draft','active','completed')
   order by c.created_at desc limit 1;
$function$;

revoke all on function car_cost_center(uuid) from public, anon;
revoke all on function car_tag_area(uuid) from public, anon;
grant execute on function car_cost_center(uuid) to authenticated;
grant execute on function car_tag_area(uuid) to authenticated;

-- ------------------------------------------- the car module's posting engine --
-- Reads a cost centre and tag area off each line, the way gl_post already does.
-- The signature does not change: adding a defaulted parameter would have made
-- every existing six-argument call ambiguous, and dropping it to re-add it
-- would have reset its grants — which is the trap migration 293 swept up after.

create or replace function car_post_entry(p_company uuid, p_date date, p_memo text,
                                          p_source text, p_reference text, p_lines jsonb)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v_entry uuid;
begin
  if exists (select 1 from journal_entries where company_id = p_company and source = p_source and reference = p_reference) then
    return false;
  end if;
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference, created_by)
  values (p_company, next_doc_number(p_company, 'journal'), coalesce(p_date, current_date), p_memo, 'posted', p_source, p_reference, auth.uid())
  returning id into v_entry;
  insert into journal_lines(entry_id, account_id, description, debit, credit, cost_center, tag_area)
  select v_entry, acct(p_company, l->>'code'), p_memo,
         round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
         nullif(btrim(coalesce(l->>'cost_center','')), ''),
         nullif(btrim(coalesce(l->>'tag_area','')), '')
  from jsonb_array_elements(p_lines) l
  where coalesce((l->>'debit')::numeric, 0) <> 0 or coalesce((l->>'credit')::numeric, 0) <> 0;
  return true;
end $function$;

-- --------------------------------------------- and every car posting sets it --

create or replace function car_post_contract(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare c car_contracts; n boolean := false; cc text; ta text;
begin
  select * into c from car_contracts where id = p_id;
  if not found or c.status not in ('active','completed') then return false; end if;
  perform car_ensure_accounts(c.company_id);
  cc := coalesce(nullif(btrim(c.cost_center),''), car_cost_center(c.vehicle_id));
  ta := coalesce(nullif(btrim(c.tag_area),''), car_tag_area(c.vehicle_id));
  n := car_post_entry(c.company_id, c.contract_date, 'Vehicle sale ' || c.contract_no, 'car_sale', c.contract_no,
    jsonb_build_array(
      jsonb_build_object('code','1150','debit',c.net_payable,'cost_center',cc,'tag_area',ta),
      jsonb_build_object('code','4200','credit',c.net_payable,'cost_center',cc,'tag_area',ta),
      jsonb_build_object('code','5100','debit',c.purchase_cost,'cost_center',cc,'tag_area',ta),
      jsonb_build_object('code','1160','credit',c.purchase_cost,'cost_center',cc,'tag_area',ta)));
  if coalesce(c.advance,0) > 0 then
    n := car_post_entry(c.company_id, c.contract_date, 'Advance ' || c.contract_no, 'car_advance', c.contract_no,
      jsonb_build_array(jsonb_build_object('code','1000','debit',c.advance,'cost_center',cc,'tag_area',ta),
                        jsonb_build_object('code','1150','credit',c.advance,'cost_center',cc,'tag_area',ta))) or n;
  end if;
  return n;
end $function$;

create or replace function car_post_vehicle(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v car_vehicles; cc text;
begin
  select * into v from car_vehicles where id = p_id;
  if not found or coalesce(v.total_cost, 0) <= 0 or v.status = 'cancelled' then return false; end if;
  -- Bought on a Purchase Voucher? That voucher already debited 1160 and
  -- credited the supplier. Posting it again here would double the purchase.
  if v.source_trade_doc is not null then return false; end if;
  perform car_ensure_accounts(v.company_id);
  cc := car_cost_center(p_id);
  return car_post_entry(v.company_id, v.purchase_date, 'Vehicle purchase ' || v.vehicle_no,
    'car_purchase', v.vehicle_no,
    jsonb_build_array(jsonb_build_object('code','1160','debit',v.total_cost,'cost_center',cc),
                      jsonb_build_object('code','2100','credit',v.total_cost,'cost_center',cc)));
end $function$;

create or replace function car_post_charge(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare c car_service_charges; cc text; ta text;
begin
  select * into c from car_service_charges where id = p_id;
  if not found then return false; end if;
  perform car_ensure_accounts(c.company_id);
  cc := car_cost_center(c.vehicle_id); ta := car_tag_area(c.vehicle_id);
  return car_post_entry(c.company_id, c.charge_month, 'Monthly service charge', 'car_scharge', c.id::text,
    jsonb_build_array(jsonb_build_object('code','1170','debit',c.amount,'cost_center',cc,'tag_area',ta),
                      jsonb_build_object('code','4300','credit',c.amount,'cost_center',cc,'tag_area',ta)));
end $function$;

create or replace function car_post_charge_payment(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare p car_service_charge_payments; v_co uuid; cc text; ta text;
begin
  select * into p from car_service_charge_payments where id = p_id;
  if not found then return false; end if;
  select c.company_id, car_cost_center(c.vehicle_id), car_tag_area(c.vehicle_id)
    into v_co, cc, ta from car_service_charges c where c.id = p.charge_id;
  if v_co is null then return false; end if;
  perform car_ensure_accounts(v_co);
  return car_post_entry(v_co, p.pay_date, 'Service charge payment', 'car_scharge_pay', p.id::text,
    jsonb_build_array(jsonb_build_object('code', case when p.method = 'cash' then '1000' else '1010' end,
                                         'debit', p.amount, 'cost_center', cc, 'tag_area', ta),
                      jsonb_build_object('code','1170','credit', p.amount, 'cost_center', cc, 'tag_area', ta)));
end $function$;

create or replace function car_post_commission(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare cm car_commissions; v_no text; cc text; ta text;
begin
  select * into cm from car_commissions where id = p_id;
  if not found or coalesce(cm.amount,0) <= 0 then return false; end if;
  select contract_no, coalesce(nullif(btrim(cost_center),''), car_cost_center(vehicle_id)),
         coalesce(nullif(btrim(tag_area),''), car_tag_area(vehicle_id))
    into v_no, cc, ta from car_contracts where id = cm.contract_id;
  if v_no is null then return false; end if;
  perform car_ensure_accounts(cm.company_id);
  return car_post_entry(cm.company_id, current_date, 'Commission ' || v_no, 'car_commission', v_no,
    jsonb_build_array(jsonb_build_object('code','6300','debit',cm.amount,'cost_center',cc,'tag_area',ta),
                      jsonb_build_object('code','2110','credit',cm.amount,'cost_center',cc,'tag_area',ta)));
end $function$;

create or replace function car_post_receipt(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare r car_receipts; cc text; ta text;
begin
  select * into r from car_receipts where id = p_id;
  if not found then return false; end if;
  perform car_ensure_accounts(r.company_id);
  select coalesce(nullif(btrim(cost_center),''), car_cost_center(vehicle_id)),
         coalesce(nullif(btrim(tag_area),''), car_tag_area(vehicle_id))
    into cc, ta from car_contracts where id = r.contract_id;
  return car_post_entry(r.company_id, r.receipt_date, 'Installment receipt ' || r.receipt_no,
    'car_receipt', r.receipt_no,
    jsonb_build_array(jsonb_build_object('code', case when r.method = 'cash' then '1000' else '1010' end,
                                         'debit', r.amount, 'cost_center', cc, 'tag_area', ta),
                      jsonb_build_object('code','1150','credit', r.amount, 'cost_center', cc, 'tag_area', ta)));
end $function$;

-- --------------------------------------- a Car Invoice's cost follows the car --
-- The invoice keeps a cost of its own — it is what COGS was posted at — but it
-- is no longer allowed to drift from the car it is selling. Both halves move
-- together: the contract's figure and the two lines of the sale entry that
-- carry it, so the ledger and the invoice can never disagree.

create or replace function car_contract_sync_cost(p_vehicle uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare c record; v_cost numeric; v_entry uuid; v_date date; v_closed date; v_n int;
begin
  select total_cost into v_cost from car_vehicles where id = p_vehicle;
  if v_cost is null then return; end if;

  for c in select * from car_contracts
            where vehicle_id = p_vehicle and status in ('draft','active','completed')
  loop
    if coalesce(c.purchase_cost, 0) = v_cost then continue; end if;

    select id, entry_date into v_entry, v_date from journal_entries
     where company_id = c.company_id and source = 'car_sale' and reference = c.contract_no;

    if v_entry is not null then
      -- A posted period is the user's line, not ours to step over.
      select closed_through into v_closed from acct_settings where company_id = c.company_id;
      if v_closed is not null and v_date <= v_closed then
        raise exception 'Car Invoice % was posted in a closed period (through %), so its cost cannot be moved to %. Reopen the period or book the difference separately.',
          c.contract_no, v_closed, v_cost;
      end if;

      -- Cost of Vehicles Sold and Vehicle Inventory are the pair that carries
      -- the cost. They move together, so the entry stays balanced.
      update journal_lines l set debit = v_cost
        from accounts a
       where a.id = l.account_id and l.entry_id = v_entry and a.code = '5100' and l.debit > 0;
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'Car Invoice % does not have one Cost of Vehicles Sold line to move (found %).', c.contract_no, v_n;
      end if;
      update journal_lines l set credit = v_cost
        from accounts a
       where a.id = l.account_id and l.entry_id = v_entry and a.code = '1160' and l.credit > 0;
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'Car Invoice % does not have one Vehicle Inventory line to move (found %).', c.contract_no, v_n;
      end if;
    end if;

    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (c.company_id, auth.uid(), 'car_contract_cost_synced', 'car_contract', c.id,
            jsonb_build_object('contract_no', c.contract_no, 'was', c.purchase_cost, 'now', v_cost,
                               'entry_adjusted', v_entry is not null));

    update car_contracts set purchase_cost = v_cost, updated_at = now() where id = c.id;
  end loop;
end $function$;

revoke all on function car_contract_sync_cost(uuid) from public, anon, authenticated;

-- ------------------------------------------ a car with expenses does not go --
-- One trigger rather than a check in each routine, because there are three
-- ways in already (the Vehicles screen, unposting a Purchase Voucher, deleting
-- one) and the next one would forget.

create or replace function car_vehicle_guard_delete()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_n int; v_amt numeric;
begin
  select count(*), coalesce(sum(amount), 0) into v_n, v_amt
    from car_vehicle_expenses where vehicle_id = old.id;
  if v_n > 0 then
    raise exception 'Car % carries % expense voucher(s) worth %. Delete those first — each one has a ledger entry that would otherwise be left behind.',
      old.vehicle_no, v_n, v_amt;
  end if;
  return old;
end $function$;

drop trigger if exists trg_car_vehicle_guard_delete on car_vehicles;
create trigger trg_car_vehicle_guard_delete
before delete on car_vehicles
for each row execute function car_vehicle_guard_delete();

-- And the constraint itself stops cascading, so nothing can take those rows
-- quietly even with the trigger out of the way.
alter table car_vehicle_expenses drop constraint if exists car_vehicle_expenses_vehicle_id_fkey;
alter table car_vehicle_expenses add constraint car_vehicle_expenses_vehicle_id_fkey
  foreign key (vehicle_id) references car_vehicles(id);

-- ------------------------------------------------- the vendor, on the record --
-- It lived only on the journal line, which is why the voucher could not be
-- reopened. Backfilled from the postings, so the vouchers already raised can be
-- edited too.

alter table car_vehicle_expenses add column if not exists credit_account uuid references accounts(id);

update car_vehicle_expenses e
   set credit_account = l.account_id
  from journal_lines l
 where l.entry_id = e.entry_id and l.credit > 0 and e.credit_account is null;

-- ---------------------------------------------------- the vendor list, honestly --
-- security invoker, so a restriction on accounts reaches it the way it reaches
-- every other read-only routine.

create or replace function car_expense_credit_accounts()
returns jsonb language sql stable security invoker set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'code', a.code, 'name', a.name, 'subtype', a.subtype)
    order by a.subtype, a.code), '[]'::jsonb)
  from accounts a
  where a.company_id = auth_company_id() and is_staff()
    and not a.is_group
    and a.subtype in ('Payable', 'Cash', 'Bank');
$function$;

revoke all on function car_expense_credit_accounts() from public, anon;
grant execute on function car_expense_credit_accounts() to authenticated;

-- --------------------------------------------------------------- the voucher --

create or replace function car_expense_save(p_id uuid, p_header jsonb)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid; v_veh uuid; v_amt numeric; v_date date;
  v_head uuid; v_name text; v_credit uuid; v_inv uuid; v_posted jsonb;
  v_entry uuid; v_no text; v_old uuid; v_line uuid; v_cc text; v_ta text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('car_expense', case when p_id is null then 'create' else 'edit' end);
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

  -- The picker is filtered by the caller's restrictions, but the routine takes
  -- whatever id is sent to it. Only the vendor is checked: Vehicle Inventory is
  -- the module's own account, not something the user chose.
  if not staff_scope_ok('account', v_credit) then
    raise exception 'That vendor account is outside the ones you are allowed to use.';
  end if;

  if p_id is not null then
    select entry_id into v_old from car_vehicle_expenses where id = p_id and company_id = v_co;
    if v_old is not null then
      update car_vehicle_expenses set entry_id = null where id = p_id;
      perform car_expense_unpost(v_old);
    end if;
  end if;

  v_cc := car_cost_center(v_veh);
  v_ta := car_tag_area(v_veh);

  -- The vehicle is DEBITED (the cost lands on the car) and the vendor is
  -- CREDITED (we owe them, or the bank paid them).
  v_posted := gl_post(v_co, v_date,
    'Car expense — ' || v_name, 'car_expense', 'car_expense', nullif(p_header->>'reference',''),
    jsonb_build_array(
      jsonb_build_object('account_id', v_inv::text,    'debit', v_amt, 'credit', 0, 'cost_center', v_cc, 'tag_area', v_ta),
      jsonb_build_object('account_id', v_credit::text, 'debit', 0,     'credit', v_amt, 'cost_center', v_cc, 'tag_area', v_ta)));
  v_entry := (v_posted->>'entry_id')::uuid;
  v_no    := v_posted->>'entry_no';

  if p_id is null then
    insert into car_vehicle_expenses(company_id, vehicle_id, expense_id, expense_name,
                                     expense_date, amount, narration, reference, entry_id,
                                     credit_account, created_by)
    values (v_co, v_veh, v_head, v_name, v_date, v_amt,
            nullif(p_header->>'narration',''), v_no, v_entry, v_credit, auth.uid())
    returning id into v_id;
  else
    update car_vehicle_expenses set
      vehicle_id = v_veh, expense_id = v_head, expense_name = v_name, expense_date = v_date,
      amount = v_amt, narration = nullif(p_header->>'narration',''), reference = v_no,
      entry_id = v_entry, credit_account = v_credit
    where id = p_id and company_id = v_co
    returning id into v_id;
    if v_id is null then raise exception 'Car expense not found'; end if;
  end if;

  -- The car costs more (or less) than it did a moment ago, so any invoice on it
  -- is now quoting the wrong cost. Bring it, and its COGS, along.
  perform car_contract_sync_cost(v_veh);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), case when p_id is null then 'car_expense_created' else 'car_expense_updated' end,
          'car_vehicle_expense', v_id, jsonb_build_object('vehicle', v_veh, 'head', v_name, 'amount', v_amt));
  return v_id;
end $function$;

revoke all on function car_expense_save(uuid, jsonb) from public, anon;
grant execute on function car_expense_save(uuid, jsonb) to authenticated;

create or replace function car_expense_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); e car_vehicle_expenses%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('car_expense', 'delete');
  select * into e from car_vehicle_expenses where id = p_id and company_id = v_co;
  if not found then raise exception 'Car expense not found'; end if;
  -- The row goes first, for the same reason: while it exists it holds a
  -- foreign key on the entry its posting lives in.
  delete from car_vehicle_expenses where id = p_id;
  if e.entry_id is not null then perform car_expense_unpost(e.entry_id); end if;
  perform car_contract_sync_cost(e.vehicle_id);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'car_expense_deleted', 'car_vehicle_expense', p_id,
          jsonb_build_object('vehicle', e.vehicle_id, 'head', e.expense_name, 'amount', e.amount));
end $function$;

revoke all on function car_expense_delete(uuid) from public, anon;
grant execute on function car_expense_delete(uuid) to authenticated;

-- ------------------------------------------------ the screen key, for rights --
-- So an entry posted by this screen can be recognised as this screen's when a
-- right is read off an existing voucher.

create or replace function staff_doc_key(p_source text)
returns text language sql immutable
as $function$
  select case p_source
    when 'gl_receipt' then 'receipt'
    when 'gl_payment' then 'payment'
    when 'gl_contra'  then 'contra'
    when 'gl_petty'   then 'petty_cash'
    when 'gl_journal' then 'journal'
    when 'gl_invoice' then 'invoice_bill'
    when 'gl_party_invoice' then 'invoice_bill'
    when 'car_expense' then 'car_expense'
    else null
  end;
$function$;

-- ------------------------------------------------------------- catching up ---
-- Every car whose invoice is quoting a stale cost is brought current, which is
-- the same routine the screen now calls. On production this is CI-000003,
-- posted at 90,000 before its 1,300 registration was booked.

do $$
declare v uuid;
begin
  for v in select distinct vehicle_id from car_contracts where status in ('draft','active','completed') loop
    perform car_contract_sync_cost(v);
  end loop;
end $$;

-- --------------------------------------------- and the car entries already there --
-- The postings raised before this migration carry no cost centre, so the car
-- business would still read as nothing in a cost-centre report until every one
-- of them had been re-raised. They are stamped from the same places the
-- routines above now read: the Car Invoice for anything that names one, the
-- vehicle for the rest. Only cost_center and tag_area are touched — no amount,
-- no account, no date — so nothing about the balances moves.

update journal_lines l
   set cost_center = coalesce(l.cost_center, nullif(btrim(c.cost_center), '')),
       tag_area    = coalesce(l.tag_area,    nullif(btrim(c.tag_area), ''))
  from journal_entries j, car_contracts c
 where j.id = l.entry_id
   and j.source in ('car_sale','car_advance','car_receipt','car_commission')
   and c.contract_no = j.reference and c.company_id = j.company_id
   and (l.cost_center is null or l.tag_area is null);

update journal_lines l
   set cost_center = coalesce(l.cost_center, car_cost_center(s.vehicle_id)),
       tag_area    = coalesce(l.tag_area,    car_tag_area(s.vehicle_id))
  from journal_entries j, car_service_charges s
 where j.id = l.entry_id and j.source = 'car_scharge'
   and s.id::text = j.reference
   and (l.cost_center is null or l.tag_area is null);

update journal_lines l
   set cost_center = coalesce(l.cost_center, car_cost_center(s.vehicle_id)),
       tag_area    = coalesce(l.tag_area,    car_tag_area(s.vehicle_id))
  from journal_entries j, car_service_charge_payments p, car_service_charges s
 where j.id = l.entry_id and j.source = 'car_scharge_pay'
   and p.id::text = j.reference and s.id = p.charge_id
   and (l.cost_center is null or l.tag_area is null);

update journal_lines l
   set cost_center = coalesce(l.cost_center, car_cost_center(v.id))
  from journal_entries j, car_vehicles v
 where j.id = l.entry_id and j.source = 'car_purchase'
   and v.vehicle_no = j.reference and v.company_id = j.company_id
   and l.cost_center is null;

-- A car expense has no reference of its own; the expense row is what knows
-- which car the entry belongs to.
update journal_lines l
   set cost_center = coalesce(l.cost_center, car_cost_center(e.vehicle_id)),
       tag_area    = coalesce(l.tag_area,    car_tag_area(e.vehicle_id))
  from journal_entries j, car_vehicle_expenses e
 where j.id = l.entry_id and j.source = 'car_expense'
   and e.entry_id = j.id
   and (l.cost_center is null or l.tag_area is null);
