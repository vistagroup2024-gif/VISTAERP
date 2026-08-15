-- 177 Car Sales — Phase 8: double-entry accounting integration.
--
-- Uses the existing GL engine (accounts / journal_entries / journal_lines) with
-- DEDICATED car AR/AP accounts kept separate from the general 1100 AR / 2000 AP.
-- car_accounting_sync() posts every not-yet-posted car event (idempotent via
-- journal_entries.source + reference), so it is safe to run repeatedly and does
-- not require mutating the operational RPCs. Every entry balances.
--
--   Purchase (received vehicle)   DR 1160 Vehicle Inventory      CR 2100 Vehicle Supplier Payable
--   Sale (active/completed)       DR 1150 Installment Receivable CR 4200 Vehicle Sales
--                                 DR 5100 Cost of Vehicles Sold  CR 1160 Vehicle Inventory
--   Advance                       DR 1000 Cash                   CR 1150 Installment Receivable
--   Installment receipt           DR 1000/1010 Cash/Bank         CR 1150 Installment Receivable
--   Service charge accrual        DR 1170 Service Charge Recv.   CR 4300 Monthly Service Charges
--   Service charge payment        DR 1000/1010 Cash/Bank         CR 1170 Service Charge Recv.
--   Commission                    DR 6300 Sales Commission       CR 2110 Commission Payable
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

create or replace function public.car_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform ensure_chart_of_accounts(p_company);
  insert into accounts(company_id, code, name, type, is_postable) values
    (p_company, '1150', 'Car Installment Receivable', 'asset', true),
    (p_company, '1160', 'Vehicle Inventory', 'asset', true),
    (p_company, '1170', 'Service Charge Receivable', 'asset', true),
    (p_company, '2100', 'Vehicle Supplier Payable', 'liability', true),
    (p_company, '2110', 'Sales Commission Payable', 'liability', true),
    (p_company, '4200', 'Vehicle Sales', 'income', true),
    (p_company, '4300', 'Monthly Service Charges', 'income', true),
    (p_company, '5100', 'Cost of Vehicles Sold', 'expense', true),
    (p_company, '6300', 'Sales Commission', 'expense', true)
  on conflict (company_id, code) do nothing;
end $$;

-- Post one balanced entry if not already posted for (source, reference). Returns true if created.
create or replace function public.car_post_entry(p_company uuid, p_date date, p_memo text, p_source text, p_reference text, p_lines jsonb)
returns boolean language plpgsql security definer set search_path to 'public' as $$
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
end $$;

create or replace function public.car_accounting_sync()
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); r record; n int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform car_ensure_accounts(v_company);

  for r in select vehicle_no, purchase_date, total_cost from car_vehicles
           where company_id = v_company and total_cost > 0 and status <> 'cancelled' loop
    if car_post_entry(v_company, r.purchase_date, 'Vehicle purchase ' || r.vehicle_no, 'car_purchase', r.vehicle_no,
        jsonb_build_array(jsonb_build_object('code','1160','debit',r.total_cost),
                          jsonb_build_object('code','2100','credit',r.total_cost))) then n := n + 1; end if;
  end loop;

  for r in select contract_no, contract_date, sale_price, advance, purchase_cost from car_contracts
           where company_id = v_company and status in ('active','completed') loop
    if car_post_entry(v_company, r.contract_date, 'Vehicle sale ' || r.contract_no, 'car_sale', r.contract_no,
        jsonb_build_array(
          jsonb_build_object('code','1150','debit',r.sale_price),
          jsonb_build_object('code','4200','credit',r.sale_price),
          jsonb_build_object('code','5100','debit',r.purchase_cost),
          jsonb_build_object('code','1160','credit',r.purchase_cost))) then n := n + 1; end if;
    if coalesce(r.advance,0) > 0 then
      if car_post_entry(v_company, r.contract_date, 'Advance ' || r.contract_no, 'car_advance', r.contract_no,
          jsonb_build_array(jsonb_build_object('code','1000','debit',r.advance),
                            jsonb_build_object('code','1150','credit',r.advance))) then n := n + 1; end if;
    end if;
  end loop;

  for r in select receipt_no, receipt_date, amount, method from car_receipts where company_id = v_company loop
    if car_post_entry(v_company, r.receipt_date, 'Installment receipt ' || r.receipt_no, 'car_receipt', r.receipt_no,
        jsonb_build_array(jsonb_build_object('code', case when r.method = 'cash' then '1000' else '1010' end, 'debit', r.amount),
                          jsonb_build_object('code','1150','credit', r.amount))) then n := n + 1; end if;
  end loop;

  for r in select id, charge_month, amount from car_service_charges where company_id = v_company loop
    if car_post_entry(v_company, r.charge_month, 'Monthly service charge', 'car_scharge', r.id::text,
        jsonb_build_array(jsonb_build_object('code','1170','debit',r.amount),
                          jsonb_build_object('code','4300','credit',r.amount))) then n := n + 1; end if;
  end loop;

  for r in select p.id, p.pay_date, p.amount, p.method from car_service_charge_payments p
           join car_service_charges c on c.id = p.charge_id where c.company_id = v_company loop
    if car_post_entry(v_company, r.pay_date, 'Service charge payment', 'car_scharge_pay', r.id::text,
        jsonb_build_array(jsonb_build_object('code', case when r.method = 'cash' then '1000' else '1010' end, 'debit', r.amount),
                          jsonb_build_object('code','1170','credit', r.amount))) then n := n + 1; end if;
  end loop;

  for r in select cm.amount, ct.contract_no from car_commissions cm
           join car_contracts ct on ct.id = cm.contract_id where cm.company_id = v_company and cm.amount > 0 loop
    if car_post_entry(v_company, current_date, 'Commission ' || r.contract_no, 'car_commission', r.contract_no,
        jsonb_build_array(jsonb_build_object('code','6300','debit',r.amount),
                          jsonb_build_object('code','2110','credit',r.amount))) then n := n + 1; end if;
  end loop;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_accounting_sync', 'car', null, jsonb_build_object('posted', n));
  return n;
end $$;
revoke all on function public.car_accounting_sync() from anon;
grant execute on function public.car_accounting_sync() to authenticated;
