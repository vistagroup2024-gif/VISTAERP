-- A car customer owes money on their own account, not on a bucket.
--
-- Reading the ledger after the last change turned up one fault wearing four
-- faces: ABDUL GHAFFAR sat at zero while the car he bought was on the books,
-- because every car posting went to a house control account instead of to him.
-- The sale debited "Car Installment Receivable", the monthly charge debited
-- "Service Charge Receivable", and his own account — which exists, because a
-- customer IS an account in this chart — was never touched. So the one screen
-- that answers "what does this customer owe" answered nothing.
--
--   the sale            Dr the customer          Cr Vehicle Sales
--   the monthly charge  Dr the customer          Cr Monthly Service Charges
--   a receipt           Dr Cash / Bank           Cr the customer
--   a charge payment    Dr Cash / Bank           Cr the customer
--
-- The control accounts are left in the chart, at nil, rather than deleted —
-- they carry the old postings' history and deleting an account with postings
-- is not this migration's business.
--
-- THE ADVANCE NO LONGER POSTS. Typing an advance on a Car Invoice was debiting
-- Cash there and then, so cash appeared with no receipt behind it — and would
-- have been counted twice the moment the matching Car Receipt was entered. The
-- advance is a figure on the invoice now; money moves when a receipt says it
-- moved.
--
-- AND THE STOCK LEDGER AGREES WITH THE GENERAL LEDGER AGAIN. A car expense
-- capitalises into Vehicle Inventory but never reached the stock valuation, so
-- the same car read 90,000 in stock and 91,300 in the accounts. A car is one
-- serialised unit, so its receipt is simply re-valued to its landed cost, the
-- way a landed cost always re-values its receipt.

-- ------------------------------------------------ the customer's own account --

create or replace function car_party_account(p_party uuid)
returns uuid language sql stable security definer set search_path to 'public'
as $function$
  select a.id from accounts a
   where a.party_id = p_party and coalesce(a.is_group, false) = false
   order by a.code limit 1;
$function$;

revoke all on function car_party_account(uuid) from public, anon;
grant execute on function car_party_account(uuid) to authenticated;

-- ------------------------------------- the engine can be told an account too --
-- Every car posting named its account by CODE, which is why they could only
-- ever reach the house accounts: a customer's account has a code of its own
-- that no routine could know. A line may now carry an account_id instead.

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
  select v_entry,
         coalesce(nullif(l->>'account_id','')::uuid, acct(p_company, l->>'code')),
         p_memo,
         round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
         nullif(btrim(coalesce(l->>'cost_center','')), ''),
         nullif(btrim(coalesce(l->>'tag_area','')), '')
  from jsonb_array_elements(p_lines) l
  where coalesce((l->>'debit')::numeric, 0) <> 0 or coalesce((l->>'credit')::numeric, 0) <> 0;
  return true;
end $function$;

-- ------------------------------------------------------------- the car sale --

create or replace function car_post_contract(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare c car_contracts; cc text; ta text; v_cust uuid;
begin
  select * into c from car_contracts where id = p_id;
  if not found or c.status not in ('active','completed') then return false; end if;
  perform car_ensure_accounts(c.company_id);
  cc := coalesce(nullif(btrim(c.cost_center),''), car_cost_center(c.vehicle_id));
  ta := coalesce(nullif(btrim(c.tag_area),''), car_tag_area(c.vehicle_id));

  -- The customer's own account. The control account is only a backstop for a
  -- contract raised without a customer; a party always has one otherwise.
  v_cust := coalesce(car_party_account(c.customer_id), acct(c.company_id, '1150'));

  return car_post_entry(c.company_id, c.contract_date, 'Vehicle sale ' || c.contract_no, 'car_sale', c.contract_no,
    jsonb_build_array(
      jsonb_build_object('account_id', v_cust, 'debit', c.net_payable, 'cost_center', cc, 'tag_area', ta),
      jsonb_build_object('code','4200','credit',c.net_payable,'cost_center',cc,'tag_area',ta),
      jsonb_build_object('code','5100','debit',c.purchase_cost,'cost_center',cc,'tag_area',ta),
      jsonb_build_object('code','1160','credit',c.purchase_cost,'cost_center',cc,'tag_area',ta)));
  -- No advance entry. An advance is what the invoice says is due up front; the
  -- cash arrives on a receipt, and only a receipt says so.
end $function$;

-- --------------------------------------------------------- the monthly charge --

create or replace function car_post_charge(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare c car_service_charges; cc text; ta text; v_cust uuid;
begin
  select * into c from car_service_charges where id = p_id;
  if not found then return false; end if;
  perform car_ensure_accounts(c.company_id);
  cc := car_cost_center(c.vehicle_id); ta := car_tag_area(c.vehicle_id);
  v_cust := coalesce(car_party_account(c.customer_id), acct(c.company_id, '1170'));
  return car_post_entry(c.company_id, c.charge_month, 'Monthly service charge', 'car_scharge', c.id::text,
    jsonb_build_array(jsonb_build_object('account_id', v_cust, 'debit', c.amount, 'cost_center', cc, 'tag_area', ta),
                      jsonb_build_object('code','4300','credit',c.amount,'cost_center',cc,'tag_area',ta)));
end $function$;

create or replace function car_post_charge_payment(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare p car_service_charge_payments; v_co uuid; cc text; ta text; v_cust uuid;
begin
  select * into p from car_service_charge_payments where id = p_id;
  if not found then return false; end if;
  select c.company_id, car_cost_center(c.vehicle_id), car_tag_area(c.vehicle_id),
         coalesce(car_party_account(c.customer_id), acct(c.company_id, '1170'))
    into v_co, cc, ta, v_cust from car_service_charges c where c.id = p.charge_id;
  if v_co is null then return false; end if;
  perform car_ensure_accounts(v_co);
  return car_post_entry(v_co, p.pay_date, 'Service charge payment', 'car_scharge_pay', p.id::text,
    jsonb_build_array(jsonb_build_object('code', case when p.method = 'cash' then '1000' else '1010' end,
                                         'debit', p.amount, 'cost_center', cc, 'tag_area', ta),
                      jsonb_build_object('account_id', v_cust, 'credit', p.amount, 'cost_center', cc, 'tag_area', ta)));
end $function$;

-- ------------------------------------------------------------- the receipt --

create or replace function car_post_receipt(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare r car_receipts; cc text; ta text; v_cust uuid;
begin
  select * into r from car_receipts where id = p_id;
  if not found then return false; end if;
  perform car_ensure_accounts(r.company_id);
  select coalesce(nullif(btrim(cost_center),''), car_cost_center(vehicle_id)),
         coalesce(nullif(btrim(tag_area),''), car_tag_area(vehicle_id))
    into cc, ta from car_contracts where id = r.contract_id;
  v_cust := coalesce(car_party_account(r.customer_id), acct(r.company_id, '1150'));
  return car_post_entry(r.company_id, r.receipt_date, 'Installment receipt ' || r.receipt_no,
    'car_receipt', r.receipt_no,
    jsonb_build_array(jsonb_build_object('code', case when r.method = 'cash' then '1000' else '1010' end,
                                         'debit', r.amount, 'cost_center', cc, 'tag_area', ta),
                      jsonb_build_object('account_id', v_cust, 'credit', r.amount, 'cost_center', cc, 'tag_area', ta)));
end $function$;

-- ------------------------------------ the stock value follows the car's cost --
-- stock_apply refuses a zero quantity, and rightly: it moves goods. Re-valuing
-- moves no goods, so it is its own small routine. A car is one unit, so there
-- is exactly one receipt to re-value.

create or replace function car_vehicle_stock_revalue(p_vehicle uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v car_vehicles; m stock_movements; iss stock_movements;
        v_cost numeric; v_delta numeric;
begin
  select * into v from car_vehicles where id = p_vehicle;
  if not found then return; end if;
  v_cost := round(coalesce(nullif(v.total_cost, 0), v.purchase_cost, 0), 2);
  if v_cost <= 0 then return; end if;

  select * into m from stock_movements
   where company_id = v.company_id and reference = v.vehicle_no and doc_type = 'receipt'
   order by created_at limit 1;
  if not found then return; end if;
  if m.value = v_cost then return; end if;

  v_delta := v_cost - m.value;

  -- The car's own issue, if it has been sold, was valued at what the car cost.
  -- Only then does it move with the receipt; a pooled average that came out at
  -- some other figure is left alone, because it is not this car's number.
  select * into iss from stock_movements
   where company_id = v.company_id and reference = v.vehicle_no and doc_type = 'issue'
     and value = m.value
   order by created_at limit 1;

  update stock_movements set rate = v_cost, value = v_cost where id = m.id;
  if iss.id is not null then
    update stock_movements set rate = v_cost, value = v_cost where id = iss.id;
  end if;

  -- Still on hand? Then the balance carries this car and moves by the
  -- difference. Sold, and the receipt and issue moved together, so it does not.
  if iss.id is null then
    update stock_balances set value = value + v_delta
     where company_id = v.company_id and item_id = m.item_id and warehouse_id = m.warehouse_id;
  end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v.company_id, auth.uid(), 'car_stock_revalued', 'car_vehicle', p_vehicle,
          jsonb_build_object('vehicle_no', v.vehicle_no, 'was', m.value, 'now', v_cost,
                             'issue_moved', iss.id is not null));
end $function$;

revoke all on function car_vehicle_stock_revalue(uuid) from public, anon, authenticated;

-- The car expense already brings the Car Invoice's cost along; it brings the
-- stock value too now, so the two ledgers cannot drift apart again.

create or replace function car_contract_sync_cost(p_vehicle uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare c record; v_cost numeric; v_entry uuid; v_date date; v_closed date; v_n int;
begin
  select total_cost into v_cost from car_vehicles where id = p_vehicle;
  if v_cost is null then return; end if;

  perform car_vehicle_stock_revalue(p_vehicle);

  for c in select * from car_contracts
            where vehicle_id = p_vehicle and status in ('draft','active','completed')
  loop
    if coalesce(c.purchase_cost, 0) = v_cost then continue; end if;

    select id, entry_date into v_entry, v_date from journal_entries
     where company_id = c.company_id and source = 'car_sale' and reference = c.contract_no;

    if v_entry is not null then
      select closed_through into v_closed from acct_settings where company_id = c.company_id;
      if v_closed is not null and v_date <= v_closed then
        raise exception 'Car Invoice % was posted in a closed period (through %), so its cost cannot be moved to %. Reopen the period or book the difference separately.',
          c.contract_no, v_closed, v_cost;
      end if;

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

-- ------------------------------------------------------------ putting it right --
-- The postings already raised are moved onto the customer, the advance that
-- posted itself is taken back out, and every car's stock value is brought to
-- its landed cost. Amounts and dates are untouched except the advance, which
-- should never have been there.

do $$
declare r record; v_cust uuid; v_n int := 0; v_adv int := 0;
begin
  -- the sale: reference is the contract number
  for r in
    select l.id as line_id, c.customer_id
      from journal_entries j
      join journal_lines l on l.entry_id = j.id
      join accounts a on a.id = l.account_id
      join car_contracts c on c.contract_no = j.reference and c.company_id = j.company_id
     where j.source = 'car_sale' and a.code = '1150'
  loop
    v_cust := car_party_account(r.customer_id);
    if v_cust is not null then
      update journal_lines set account_id = v_cust where id = r.line_id;
      v_n := v_n + 1;
    end if;
  end loop;

  -- a receipt: reference is the receipt number, and the customer is on it
  for r in
    select l.id as line_id, rc.customer_id
      from journal_entries j
      join journal_lines l on l.entry_id = j.id
      join accounts a on a.id = l.account_id
      join car_receipts rc on rc.receipt_no = j.reference and rc.company_id = j.company_id
     where j.source = 'car_receipt' and a.code = '1150'
  loop
    v_cust := car_party_account(r.customer_id);
    if v_cust is not null then
      update journal_lines set account_id = v_cust where id = r.line_id;
      v_n := v_n + 1;
    end if;
  end loop;

  -- the monthly charges and their payments
  for r in
    select l.id as line_id, s.customer_id
      from journal_entries j
      join journal_lines l on l.entry_id = j.id
      join accounts a on a.id = l.account_id
      join car_service_charges s on s.id::text = j.reference
     where j.source = 'car_scharge' and a.code = '1170'
  loop
    v_cust := car_party_account(r.customer_id);
    if v_cust is not null then
      update journal_lines set account_id = v_cust where id = r.line_id;
      v_n := v_n + 1;
    end if;
  end loop;

  -- the advance that posted itself: taken out whole, both sides
  for r in select id from journal_entries where source = 'car_advance' loop
    delete from journal_lines where entry_id = r.id;
    delete from journal_entries where id = r.id;
    v_adv := v_adv + 1;
  end loop;

  -- and every car's stock value
  for r in select id from car_vehicles loop
    perform car_vehicle_stock_revalue(r.id);
  end loop;

  raise notice 'Moved % line(s) onto their customer; removed % self-posted advance(s).', v_n, v_adv;
end $$;
