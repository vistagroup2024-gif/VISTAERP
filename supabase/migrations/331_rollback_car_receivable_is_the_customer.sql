-- Rollback 331. Code only. The data corrections are NOT undone and should not
-- be: the customer's own account carries what he owes, the advance that posted
-- itself is gone, and the stock ledger agrees with the general ledger. Putting
-- those back means putting the faults back.
--
-- After this, car sales debit "Car Installment Receivable" again, monthly
-- charges debit "Service Charge Receivable", an advance on a Car Invoice posts
-- cash on its own, and a car expense stops reaching the stock value.

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

-- car_contract_sync_cost without the stock revaluation (330's version)
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
      select closed_through into v_closed from acct_settings where company_id = c.company_id;
      if v_closed is not null and v_date <= v_closed then
        raise exception 'Car Invoice % was posted in a closed period (through %).', c.contract_no, v_closed;
      end if;
      update journal_lines l set debit = v_cost from accounts a
       where a.id = l.account_id and l.entry_id = v_entry and a.code = '5100' and l.debit > 0;
      get diagnostics v_n = row_count;
      if v_n <> 1 then raise exception 'Car Invoice % has % COGS lines.', c.contract_no, v_n; end if;
      update journal_lines l set credit = v_cost from accounts a
       where a.id = l.account_id and l.entry_id = v_entry and a.code = '1160' and l.credit > 0;
      get diagnostics v_n = row_count;
      if v_n <> 1 then raise exception 'Car Invoice % has % inventory lines.', c.contract_no, v_n; end if;
    end if;
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (c.company_id, auth.uid(), 'car_contract_cost_synced', 'car_contract', c.id,
            jsonb_build_object('contract_no', c.contract_no, 'was', c.purchase_cost, 'now', v_cost));
    update car_contracts set purchase_cost = v_cost, updated_at = now() where id = c.id;
  end loop;
end $function$;

revoke all on function car_contract_sync_cost(uuid) from public, anon, authenticated;

drop function if exists car_vehicle_stock_revalue(uuid);
drop function if exists car_party_account(uuid);
