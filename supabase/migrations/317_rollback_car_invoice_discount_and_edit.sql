-- ROLLBACK for 317_car_invoice_discount_and_edit.sql.
--
-- Puts the Car Invoice back to one price and no editing: sale_price alone is
-- what posts, a saved invoice refuses to change, and only a draft can be
-- deleted.
--
-- READ THIS BEFORE RUNNING IT. The discount column is NOT dropped, on purpose —
-- dropping it would throw away every discount that has been given. What the
-- rollback does is stop reading it, so an invoice saved with a discount goes
-- back to being worth its FULL sale_price everywhere: the ledger will already
-- hold the discounted figures from when it was posted, and the reports will
-- show the gross. So either
--
--   * roll back only while no invoice has a discount:
--         select contract_no, sale_price, discount from car_contracts where discount <> 0;
--     — an empty result means this is a clean reversal; or
--   * re-save those invoices with the discount folded into the price first.
--
-- Drop the two columns by hand once you are sure nothing needs them:
--     alter table car_contracts drop column net_payable;
--     alter table car_contracts drop column discount;

-- --------------------------------------------------------------- posting ----

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
      jsonb_build_object('code','1150','debit',c.sale_price),
      jsonb_build_object('code','4200','credit',c.sale_price),
      jsonb_build_object('code','5100','debit',c.purchase_cost),
      jsonb_build_object('code','1160','credit',c.purchase_cost)));
  if coalesce(c.advance,0) > 0 then
    n := car_post_entry(c.company_id, c.contract_date, 'Advance ' || c.contract_no, 'car_advance', c.contract_no,
      jsonb_build_array(jsonb_build_object('code','1000','debit',c.advance),
                        jsonb_build_object('code','1150','credit',c.advance))) or n;
  end if;
  return n;
end $function$;

-- ------------------------------------------------------------------ save ----

create or replace function car_contract_save(p_id uuid, p_header jsonb, p_installments jsonb)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_company uuid := auth_company_id(); v_id uuid; v_no text;
  v_vehicle uuid := nullif(p_header->>'vehicle_id','')::uuid;
  v_sale numeric := coalesce(nullif(p_header->>'sale_price','')::numeric, 0);
  v_adv  numeric := coalesce(nullif(p_header->>'advance','')::numeric, 0);
  v_sched numeric; v_cost numeric; it jsonb; i int := 0; v_status car_contract_status;
  v_keep boolean := coalesce((p_header->>'keep_vista')::boolean, true);
  v_new boolean := p_id is null;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if v_vehicle is null then raise exception 'Select a vehicle'; end if;
  if nullif(p_header->>'customer_id','') is null then raise exception 'Select a customer'; end if;

  v_sched := coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(p_installments,'[]'::jsonb)) e), 0);
  if round(v_adv + v_sched, 2) <> round(v_sale, 2) then
    raise exception 'Advance (%) + installments (%) = % but must equal the sale price % (difference %).',
      round(v_adv,2), round(v_sched,2), round(v_adv+v_sched,2), round(v_sale,2), round(v_sale-(v_adv+v_sched),2);
  end if;

  if v_new then
    if exists (select 1 from car_contracts where vehicle_id = v_vehicle and status in ('draft','active')) then
      raise exception 'This vehicle already has an active car invoice.';
    end if;
    select total_cost into v_cost from car_vehicles where id = v_vehicle and company_id = v_company;
    v_no := 'CI-' || lpad(nextval('car_contract_seq')::text, 6, '0');
    insert into car_contracts(company_id, contract_no, customer_id, vehicle_id, purchase_cost, created_by)
    values (v_company, v_no, (p_header->>'customer_id')::uuid, v_vehicle, coalesce(v_cost,0), auth.uid())
    returning id into v_id;
  else
    v_id := p_id;
    select status into v_status from car_contracts where id = v_id and company_id = v_company;
    if v_status is distinct from 'draft' then raise exception 'This car invoice is finalised; use adjustments to change it.'; end if;
  end if;

  update car_contracts set
    customer_id  = (p_header->>'customer_id')::uuid,
    vehicle_id   = v_vehicle,
    contract_date = coalesce(nullif(p_header->>'contract_date','')::date, contract_date),
    advance_due_date = nullif(p_header->>'advance_due_date','')::date,
    cost_center  = nullif(p_header->>'cost_center',''),
    tag_area     = nullif(p_header->>'tag_area',''),
    sale_price   = v_sale,
    advance      = v_adv,
    reference_name = nullif(p_header->>'reference_name',''),
    salesperson  = nullif(p_header->>'salesperson',''),
    notes        = nullif(p_header->>'notes',''),
    updated_at   = now()
  where id = v_id and company_id = v_company;

  delete from car_installments where contract_id = v_id;
  for it in select * from jsonb_array_elements(coalesce(p_installments,'[]'::jsonb)) loop
    i := i + 1;
    insert into car_installments(contract_id, inst_no, due_date, amount, notes)
    values (v_id, i, (it->>'due_date')::date, coalesce(nullif(it->>'amount','')::numeric,0), nullif(it->>'notes',''));
  end loop;

  update car_contracts set expected_completion_date = (select max(due_date) from car_installments where contract_id = v_id)
  where id = v_id;

  update car_vehicles set
    current_customer_id = (p_header->>'customer_id')::uuid, contract_id = v_id,
    status = case when v_new then (case when status in ('in_stock','reserved') then 'sold' else status end)
                  when status = 'in_stock' then 'reserved' else status end,
    ownership = case when v_new then (case when v_keep then 'vista' else 'transferred' end)::car_ownership_status else ownership end
  where id = v_vehicle and company_id = v_company;

  if v_new then
    update car_contracts set status = 'active',
      start_date = coalesce(start_date, (select min(due_date) from car_installments where contract_id = v_id), current_date)
    where id = v_id;
  end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when v_new then 'car_invoice_created' else 'car_invoice_updated' end,
          'car_contract', v_id, jsonb_build_object('sale_price', v_sale, 'advance', v_adv, 'installments', i, 'keep_vista', v_keep));
  return v_id;
end $function$;

revoke all on function car_contract_save(uuid, jsonb, jsonb) from public, anon;
grant execute on function car_contract_save(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- delete ----

create or replace function car_contract_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_vehicle uuid; v_status car_contract_status;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select status, vehicle_id into v_status, v_vehicle from car_contracts where id = p_id and company_id = v_company;
  if not found then raise exception 'Contract not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft contracts can be deleted.'; end if;
  delete from car_contracts where id = p_id and company_id = v_company;
  update car_vehicles set status = case when status = 'reserved' then 'in_stock' else status end,
    current_customer_id = null, contract_id = null
  where id = v_vehicle and contract_id = p_id;
end $function$;

revoke all on function car_contract_delete(uuid) from public, anon;
grant execute on function car_contract_delete(uuid) to authenticated;

-- ------------------------------------------------------------ commission ----

create or replace function car_commission_save(p_contract uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_type text; v_val numeric; v_amount numeric; v_sale numeric;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select sale_price into v_sale from car_contracts where id = p_contract and company_id = v_company;
  if not found then raise exception 'Contract not found'; end if;
  v_type := coalesce(nullif(p->>'comm_type',''),'fixed');
  v_val := coalesce(nullif(p->>'comm_value','')::numeric, 0);
  v_amount := case when v_type = 'percentage' then round(coalesce(v_sale,0) * v_val / 100, 2) else v_val end;
  insert into car_commissions(company_id, contract_id, reference_name, comm_type, comm_value, amount, paid, paid_date, notes)
  values (v_company, p_contract, nullif(p->>'reference_name',''), v_type, v_val, v_amount,
          coalesce((p->>'paid')::boolean,false), nullif(p->>'paid_date','')::date, nullif(p->>'notes',''))
  on conflict (contract_id) do update set
    reference_name = excluded.reference_name, comm_type = excluded.comm_type, comm_value = excluded.comm_value,
    amount = excluded.amount, paid = excluded.paid, paid_date = excluded.paid_date, notes = excluded.notes;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_commission_saved', 'car_contract', p_contract, jsonb_build_object('amount', v_amount));
end $function$;

revoke all on function car_commission_save(uuid, jsonb) from public, anon;
grant execute on function car_commission_save(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------- dashboard ----

do $$
declare src text; out text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dashboard_metrics';
  out := replace(src, 'coalesce(sum(c.net_payable), 0) as sale_value',
                      'coalesce(sum(c.sale_price), 0) as sale_value');
  if out = src then
    raise exception 'dashboard_metrics: the car sale_value line has moved — patch it by hand.';
  end if;
  execute out;
end $$;

do $$
declare src text; out text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dashboard_module_metrics';
  out := replace(src, '''value'',     coalesce(sum(net_payable), 0))',
                      '''value'',     coalesce(sum(sale_price), 0))');
  if out = src then
    raise exception 'dashboard_module_metrics: the car value line has moved — patch it by hand.';
  end if;
  execute out;
end $$;

-- car_contract_unpost is left in place but unreachable — nothing calls it once
-- the two bodies above are back, and it is granted to nobody.
--     drop function if exists car_contract_unpost(uuid, text);
