-- The Car Invoice gets the fields a Sale Order already carries.
--
-- It is raised from a car Sale Order, and that Sale Order knows its cost centre,
-- its tag area and when the advance falls due. None of the three had anywhere to
-- land here, so loading an order dropped them and they were typed again — or,
-- more often, lost. Three columns and the save routine that writes them.
--
-- Delivery Date goes the other way. A Car Invoice is raised when the car is
-- handed over, and the handover has its own screen and its own date; a second
-- delivery date on the invoice was a field with no reader. The column stays
-- (nothing is dropped from a table that has history) but the routine no longer
-- writes it and the screen no longer shows it.

alter table car_contracts
  add column if not exists advance_due_date date,
  add column if not exists cost_center text,
  add column if not exists tag_area text;

comment on column car_contracts.advance_due_date is
  'When the advance is due. Comes across from the Sale Order''s advance_due_date.';
comment on column car_contracts.cost_center is
  'CAR SALES INSTALLMENT or CAR TRADING, from the Sale Order it was raised from.';
comment on column car_contracts.delivery_date is
  'No longer written or shown — the handover screen carries the delivery date.
   Kept for the invoices that already have one.';

create or replace function public.car_contract_save(p_id uuid, p_header jsonb, p_installments jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
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

-- ── Loading a Sale Order should leave nothing to retype ─────────────────────
-- The screen used to read the order and pick out four fields. It now asks for
-- the whole thing, resolved: the customer, the costing boxes, the cost centre,
-- the tag area, the advance and when it falls due — and the VEHICLE, which is
-- the part it could not work out for itself. The order's line names the item;
-- the yard holds one car against that item, and this finds it.
create or replace function public.car_invoice_from_sale_order(p_doc uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when d.id is null then null else jsonb_build_object(
    'id', d.id, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
    'customer_id', d.party_id,
    'cost_center', d.cost_center, 'tag_area', d.tag_area,
    'reference_name', d.reference, 'notes', d.narration,
    'sale_price', coalesce(nullif(d.meta->>'selling_price','')::numeric, d.total),
    'advance', coalesce(nullif(d.meta->>'advance','')::numeric, 0),
    'advance_due_date', nullif(d.meta->>'advance_due_date',''),
    'installment_months', coalesce(nullif(d.meta->>'installment_months','')::int, 0),
    -- The item on the order IS the vehicle. Match the one car in stock against
    -- that product; if the order names no product, or the yard has none free
    -- for it, this comes back null and the operator picks — which is the only
    -- case the old screen was right to leave alone.
    'vehicle_id', (
      select v.id from car_vehicles v
      join trade_document_lines l on l.doc_id = d.id and l.product_id = v.product_id
      where v.company_id = d.company_id and v.status in ('in_stock','reserved')
        and not exists (select 1 from car_contracts c
                         where c.vehicle_id = v.id and c.status in ('draft','active'))
      order by v.created_at limit 1),
    'item_name', (select l.item_name from trade_document_lines l
                   where l.doc_id = d.id order by l.sort limit 1)
  ) end
  from trade_documents d
  where d.id = p_doc and d.company_id = auth_company_id() and d.doc_type = 'sale_order';
$function$;

revoke all on function public.car_invoice_from_sale_order(uuid) from public, anon;
grant execute on function public.car_invoice_from_sale_order(uuid) to authenticated;

-- ── The number said "contract" too ──────────────────────────────────────────
-- CTR- was the old name showing through on every document. CI- matches the
-- rest of the ERP (SI-, PV-, SO-) and matches what the screen calls it.
-- Safe to change outright: car_contracts is empty, so no invoice on record
-- carries the old prefix and nothing has to be migrated or dual-read.
create or replace function public.car_contract_save(p_id uuid, p_header jsonb, p_installments jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
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
