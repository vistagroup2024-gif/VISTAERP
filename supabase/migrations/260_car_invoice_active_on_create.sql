-- 260_car_invoice_active_on_create.sql
-- A Car Invoice (installment contract) is ACTIVE the moment it is created — no
-- separate "Activate" step. On creation the vehicle is marked sold and its
-- registration side is decided by the invoice's "keep in Vista name" flag:
--   keep_vista = true  (default) -> ownership stays 'vista' -> monthly service
--        charges apply (installment, or a trading car retained in our name).
--   keep_vista = false           -> ownership -> 'transferred' -> no charges
--        (e.g. a cash trading sale handed over in the customer's name).
-- Monthly charges then generate via the status->active trigger (258), gated on
-- ownership = 'vista' (259).

create or replace function public.car_contract_save(p_id uuid, p_header jsonb, p_installments jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
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
      raise exception 'This vehicle already has an active contract.';
    end if;
    select total_cost into v_cost from car_vehicles where id = v_vehicle and company_id = v_company;
    v_no := 'CTR-' || lpad(nextval('car_contract_seq')::text, 6, '0');
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
    delivery_date = nullif(p_header->>'delivery_date','')::date,
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

  -- Link the customer to the vehicle. On a NEW invoice: decide the registration
  -- side and mark the vehicle sold, then activate the invoice (which triggers
  -- monthly-charge generation for a Vista-name vehicle). Ownership is set BEFORE
  -- activation so the charge gate sees the final value.
  update car_vehicles set
    current_customer_id = (p_header->>'customer_id')::uuid, contract_id = v_id,
    status = case when v_new then (case when status in ('in_stock','reserved') then 'sold' else status end)
                  when status = 'in_stock' then 'reserved' else status end,
    ownership = case when v_new then (case when v_keep then 'vista' else 'transferred' end) else ownership end
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
end $$;
revoke all on function public.car_contract_save(uuid, jsonb, jsonb) from anon;
grant execute on function public.car_contract_save(uuid, jsonb, jsonb) to authenticated;
