-- Rollback 330. This puts the CODE back; it does not put the numbers back, and
-- it cannot, because the numbers were wrong.
--
-- Two data corrections stand after this runs:
--   * CI-000003's cost went from 90,000 to 91,300 and its Cost of Vehicles Sold
--     / Vehicle Inventory pair with it. That is the car's real cost. Reversing
--     it would put the overstated margin back.
--   * the cost centre and tag area stamped on car postings that had none.
-- Undo either by hand if you truly mean to.
--
-- After this the Car Expense screen posts on save with no cost centre, no
-- rights, no restriction check and no live cost, and deleting a car takes its
-- expenses with it again — so put the frontend back at the same time
-- (lib/docRights.ts, app/(erp)/car-sales/expenses/*).

drop trigger if exists trg_car_vehicle_guard_delete on car_vehicles;
drop function if exists car_vehicle_guard_delete();

alter table car_vehicle_expenses drop constraint if exists car_vehicle_expenses_vehicle_id_fkey;
alter table car_vehicle_expenses add constraint car_vehicle_expenses_vehicle_id_fkey
  foreign key (vehicle_id) references car_vehicles(id) on delete cascade;

alter table car_vehicle_expenses drop column if exists credit_account;

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
  insert into journal_lines(entry_id, account_id, description, debit, credit)
  select v_entry, acct(p_company, l->>'code'), p_memo,
         round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2)
  from jsonb_array_elements(p_lines) l
  where coalesce((l->>'debit')::numeric, 0) <> 0 or coalesce((l->>'credit')::numeric, 0) <> 0;
  return true;
end $function$;

create or replace function car_post_contract(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare c car_contracts; n boolean := false;
begin
  select * into c from car_contracts where id = p_id;
  if not found or c.status not in ('active','completed') then return false; end if;
  perform car_ensure_accounts(c.company_id);
  n := car_post_entry(c.company_id, c.contract_date, 'Vehicle sale ' || c.contract_no, 'car_sale', c.contract_no,
    jsonb_build_array(
      jsonb_build_object('code','1150','debit',c.net_payable),
      jsonb_build_object('code','4200','credit',c.net_payable),
      jsonb_build_object('code','5100','debit',c.purchase_cost),
      jsonb_build_object('code','1160','credit',c.purchase_cost)));
  if coalesce(c.advance,0) > 0 then
    n := car_post_entry(c.company_id, c.contract_date, 'Advance ' || c.contract_no, 'car_advance', c.contract_no,
      jsonb_build_array(jsonb_build_object('code','1000','debit',c.advance),
                        jsonb_build_object('code','1150','credit',c.advance))) or n;
  end if;
  return n;
end $function$;

create or replace function car_post_vehicle(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v car_vehicles;
begin
  select * into v from car_vehicles where id = p_id;
  if not found or coalesce(v.total_cost, 0) <= 0 or v.status = 'cancelled' then return false; end if;
  if v.source_trade_doc is not null then return false; end if;
  perform car_ensure_accounts(v.company_id);
  return car_post_entry(v.company_id, v.purchase_date, 'Vehicle purchase ' || v.vehicle_no,
    'car_purchase', v.vehicle_no,
    jsonb_build_array(jsonb_build_object('code','1160','debit',v.total_cost),
                      jsonb_build_object('code','2100','credit',v.total_cost)));
end $function$;

create or replace function car_post_charge(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare c car_service_charges;
begin
  select * into c from car_service_charges where id = p_id;
  if not found then return false; end if;
  perform car_ensure_accounts(c.company_id);
  return car_post_entry(c.company_id, c.charge_month, 'Monthly service charge', 'car_scharge', c.id::text,
    jsonb_build_array(jsonb_build_object('code','1170','debit',c.amount),
                      jsonb_build_object('code','4300','credit',c.amount)));
end $function$;

create or replace function car_post_charge_payment(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare p car_service_charge_payments; v_co uuid;
begin
  select * into p from car_service_charge_payments where id = p_id;
  if not found then return false; end if;
  select c.company_id into v_co from car_service_charges c where c.id = p.charge_id;
  if v_co is null then return false; end if;
  perform car_ensure_accounts(v_co);
  return car_post_entry(v_co, p.pay_date, 'Service charge payment', 'car_scharge_pay', p.id::text,
    jsonb_build_array(jsonb_build_object('code', case when p.method = 'cash' then '1000' else '1010' end, 'debit', p.amount),
                      jsonb_build_object('code','1170','credit', p.amount)));
end $function$;

create or replace function car_post_commission(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare cm car_commissions; v_no text;
begin
  select * into cm from car_commissions where id = p_id;
  if not found or coalesce(cm.amount,0) <= 0 then return false; end if;
  select contract_no into v_no from car_contracts where id = cm.contract_id;
  if v_no is null then return false; end if;
  perform car_ensure_accounts(cm.company_id);
  return car_post_entry(cm.company_id, current_date, 'Commission ' || v_no, 'car_commission', v_no,
    jsonb_build_array(jsonb_build_object('code','6300','debit',cm.amount),
                      jsonb_build_object('code','2110','credit',cm.amount)));
end $function$;

create or replace function car_post_receipt(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare r car_receipts;
begin
  select * into r from car_receipts where id = p_id;
  if not found then return false; end if;
  perform car_ensure_accounts(r.company_id);
  return car_post_entry(r.company_id, r.receipt_date, 'Installment receipt ' || r.receipt_no,
    'car_receipt', r.receipt_no,
    jsonb_build_array(jsonb_build_object('code', case when r.method = 'cash' then '1000' else '1010' end, 'debit', r.amount),
                      jsonb_build_object('code','1150','credit', r.amount)));
end $function$;

create or replace function car_expense_credit_accounts()
returns jsonb language sql stable security definer set search_path to 'public'
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

create or replace function car_expense_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); e car_vehicle_expenses%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into e from car_vehicle_expenses where id = p_id and company_id = v_co;
  if not found then raise exception 'Car expense not found'; end if;
  delete from car_vehicle_expenses where id = p_id;
  if e.entry_id is not null then perform car_expense_unpost(e.entry_id); end if;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'car_expense_deleted', 'car_vehicle_expense', p_id,
          jsonb_build_object('vehicle', e.vehicle_id, 'head', e.expense_name, 'amount', e.amount));
end $function$;

revoke all on function car_expense_delete(uuid) from public, anon;
grant execute on function car_expense_delete(uuid) to authenticated;

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
    else null
  end;
$function$;

drop function if exists car_contract_sync_cost(uuid);
drop function if exists car_cost_center(uuid);
drop function if exists car_tag_area(uuid);
