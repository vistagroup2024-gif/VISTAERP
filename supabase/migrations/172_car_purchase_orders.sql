-- 172 Car Sales — Phase 2: Purchase Orders + receive-into-stock (Purchase Voucher).
--
-- A Purchase Order lists vehicles to buy from a supplier. "Receiving" the PO
-- (posting the purchase voucher) creates one car_vehicles master record per line
-- (status in_stock), linking the line to the vehicle. This distinguishes:
--   Ordered  = PO lines not yet received
--   In stock = vehicles created on receipt
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

do $$ begin
  create type car_po_status as enum ('draft','ordered','received','cancelled');
exception when duplicate_object then null; end $$;

create sequence if not exists car_purchase_seq;

create table if not exists car_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default auth_company_id() references companies(id) on delete cascade,
  po_no text not null,
  po_date date not null default current_date,
  supplier_id uuid references parties(id) on delete set null,
  status car_po_status not null default 'draft',
  expected_date date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  unique (company_id, po_no)
);
alter table car_purchase_orders enable row level security;
drop policy if exists car_po_staff on car_purchase_orders;
create policy car_po_staff on car_purchase_orders for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create table if not exists car_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references car_purchase_orders(id) on delete cascade,
  make text, model text, variant text, model_year int, color text,
  vin text, plate_no text, engine_no text,
  purchase_cost numeric(18,2) not null default 0,
  purchase_vat  numeric(18,2) not null default 0,
  vehicle_id uuid references car_vehicles(id) on delete set null,
  received boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table car_purchase_order_items enable row level security;
drop policy if exists car_po_items_staff on car_purchase_order_items;
create policy car_po_items_staff on car_purchase_order_items for all to authenticated
  using (exists (select 1 from car_purchase_orders o where o.id = po_id and o.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from car_purchase_orders o where o.id = po_id and o.company_id = auth_company_id() and is_staff()));

-- Save PO header + lines. Received lines (already turned into vehicles) are preserved.
create or replace function public.car_po_save(p_id uuid, p_header jsonb, p_items jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_id uuid; v_no text; it jsonb; v_iid uuid; v_keep uuid[] := '{}';
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then
    v_no := 'PO-' || lpad(nextval('car_purchase_seq')::text, 6, '0');
    insert into car_purchase_orders(company_id, po_no, created_by) values (v_company, v_no, auth.uid()) returning id into v_id;
  else
    v_id := p_id;
  end if;

  update car_purchase_orders set
    po_date       = coalesce(nullif(p_header->>'po_date','')::date, po_date),
    supplier_id   = nullif(p_header->>'supplier_id','')::uuid,
    expected_date = nullif(p_header->>'expected_date','')::date,
    status        = coalesce(nullif(p_header->>'status','')::car_po_status, status),
    notes         = nullif(p_header->>'notes',''),
    updated_at    = now()
  where id = v_id and company_id = v_company;
  if not found then raise exception 'Purchase order not found'; end if;

  -- keep received lines
  for v_iid in select id from car_purchase_order_items where po_id = v_id and received loop
    v_keep := array_append(v_keep, v_iid);
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if nullif(it->>'id','') is not null then
      v_iid := (it->>'id')::uuid;
      update car_purchase_order_items set
        make = nullif(it->>'make',''), model = nullif(it->>'model',''), variant = nullif(it->>'variant',''),
        model_year = nullif(it->>'model_year','')::int, color = nullif(it->>'color',''),
        vin = nullif(it->>'vin',''), plate_no = nullif(it->>'plate_no',''), engine_no = nullif(it->>'engine_no',''),
        purchase_cost = coalesce(nullif(it->>'purchase_cost','')::numeric, 0),
        purchase_vat = coalesce(nullif(it->>'purchase_vat','')::numeric, 0),
        sort = coalesce(nullif(it->>'sort','')::int, 0)
      where id = v_iid and po_id = v_id and not received;
    else
      insert into car_purchase_order_items(po_id, make, model, variant, model_year, color, vin, plate_no, engine_no, purchase_cost, purchase_vat, sort)
      values (v_id, nullif(it->>'make',''), nullif(it->>'model',''), nullif(it->>'variant',''),
        nullif(it->>'model_year','')::int, nullif(it->>'color',''), nullif(it->>'vin',''), nullif(it->>'plate_no',''),
        nullif(it->>'engine_no',''), coalesce(nullif(it->>'purchase_cost','')::numeric,0), coalesce(nullif(it->>'purchase_vat','')::numeric,0),
        coalesce(nullif(it->>'sort','')::int,0))
      returning id into v_iid;
    end if;
    v_keep := array_append(v_keep, v_iid);
  end loop;

  delete from car_purchase_order_items where po_id = v_id and not received and not (id = any(v_keep));

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when p_id is null then 'car_po_created' else 'car_po_updated' end,
          'car_purchase_order', v_id, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function public.car_po_save(uuid, jsonb, jsonb) from anon;
grant execute on function public.car_po_save(uuid, jsonb, jsonb) to authenticated;

-- Receive the PO into stock: each un-received line becomes a car_vehicles record.
create or replace function public.car_po_receive(p_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_po car_purchase_orders; it record; v_vid uuid; v_no text; n int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into v_po from car_purchase_orders where id = p_id and company_id = v_company;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_po.status = 'cancelled' then raise exception 'This purchase order is cancelled.'; end if;

  for it in select * from car_purchase_order_items where po_id = p_id and not received order by sort, created_at loop
    v_no := 'CAR-' || lpad(nextval('car_vehicle_seq')::text, 6, '0');
    insert into car_vehicles(company_id, vehicle_no, make, model, variant, model_year, color, vin, plate_no, engine_no,
      purchase_date, supplier_id, purchase_cost, purchase_vat, status, ownership, created_by)
    values (v_company, v_no, it.make, it.model, it.variant, it.model_year, it.color, it.vin, it.plate_no, it.engine_no,
      v_po.po_date, v_po.supplier_id, it.purchase_cost, it.purchase_vat, 'in_stock', 'vista', auth.uid())
    returning id into v_vid;
    update car_purchase_order_items set vehicle_id = v_vid, received = true where id = it.id;
    n := n + 1;
  end loop;

  update car_purchase_orders set status = 'received', updated_at = now()
  where id = p_id and not exists (select 1 from car_purchase_order_items where po_id = p_id and not received);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_po_received', 'car_purchase_order', p_id, jsonb_build_object('vehicles', n));
  return n;
end $$;
revoke all on function public.car_po_receive(uuid) from anon;
grant execute on function public.car_po_receive(uuid) to authenticated;

create or replace function public.car_po_set_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_status not in ('draft','ordered','cancelled') then raise exception 'Invalid status'; end if;
  update car_purchase_orders set status = p_status::car_po_status, updated_at = now()
  where id = p_id and company_id = v_company and status <> 'received';
  if not found then raise exception 'Purchase order not found or already received'; end if;
end $$;
revoke all on function public.car_po_set_status(uuid, text) from anon;
grant execute on function public.car_po_set_status(uuid, text) to authenticated;

create or replace function public.car_po_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if exists (select 1 from car_purchase_order_items where po_id = p_id and received) then
    raise exception 'Cannot delete a purchase order that has received vehicles.';
  end if;
  delete from car_purchase_orders where id = p_id and company_id = v_company;
  if not found then raise exception 'Purchase order not found'; end if;
end $$;
revoke all on function public.car_po_delete(uuid) from anon;
grant execute on function public.car_po_delete(uuid) to authenticated;
