-- A car is bought straight onto a Purchase Voucher. Everything else still
-- arrives through a Material Receipt Note.
--
-- The document chain says a Purchase Voucher is loaded from an MRN, and that is
-- right for stock: goods turn up at a warehouse, somebody counts them, and the
-- bill is matched to what was counted. A car has no warehouse to be received
-- into — it is one serialised unit that arrives as itself — so the MRN step is
-- a screen somebody has to fill in with nothing in order to get to the bill.
--
-- WHAT THIS IS NOT. It is not "switch off the MRN step". CLAUDE.md already
-- describes that: turning a step off in workflow_steps closes the chain up for
-- EVERYBODY, and the business still receives stock through MRNs. The chain has
-- to fork on what is being bought, not be shortened for all of it.
--
-- So the source of a Purchase Voucher becomes a question about the DOCUMENT
-- being loaded rather than about the voucher type alone: a Purchase Order on a
-- car cost centre feeds the Purchase Voucher directly; anything else still goes
-- through its MRN. One helper answers it, and both the Load picker and the Load
-- itself ask that same helper — which is what stops the picker offering a
-- document the load would then refuse.
--
-- It reads BOTH ways round, and that is deliberate:
--
--   car    + purchase_voucher -> purchase_order   the fork
--   car    + mrn              -> null             no MRN in a car's chain, so a
--                                                 car PO is not offered there
--                                                 either — otherwise the same
--                                                 car could be received twice,
--                                                 once down each path
--   anything else             -> the configured chain, untouched

begin;

create or replace function public.trade_doc_source_type_for(p_target text, p_cost_center text)
returns text
language sql
stable
set search_path to 'public'
as $f$
  select case
    when is_car_cost_center(p_cost_center) and p_target = 'purchase_voucher' then 'purchase_order'
    when is_car_cost_center(p_cost_center) and p_target = 'mrn' then null
    else workflow_source_type(auth_company_id(), p_target)
  end;
$f$;
revoke all on function public.trade_doc_source_type_for(text, text) from public, anon;
grant execute on function public.trade_doc_source_type_for(text, text) to authenticated;

-- ── what the Load button offers ────────────────────────────────────────────
-- The doc_type test now asks the helper WITH THE DOCUMENT'S OWN COST CENTRE,
-- which makes the fork fall out of one condition rather than needing a special
-- case: a car PO matches for purchase_voucher and not for mrn, a stock MRN
-- matches for purchase_voucher, and a stock PO matches only for mrn.
create or replace function public.trade_doc_pending(p_target_type text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with docs as (
    select d.id, d.doc_no, d.doc_date,
           (select p.name from parties p where p.id = d.party_id) party_name,
           d.cost_center, d.reference, d.total,
           (select count(*) from trade_document_lines l where l.doc_id = d.id) lines,
           'trade' as source_kind
    from trade_documents d
    where d.company_id = auth_company_id()
      and d.doc_type = trade_doc_source_type_for(p_target_type, d.cost_center)
      and coalesce(d.status, 'open') not in ('cancelled', 'closed', 'awaiting_approval')
      and not exists (
        select 1 from trade_documents t
        where t.company_id = d.company_id and t.doc_type = p_target_type and t.source_doc_id = d.id)
      and (p_target_type <> 'sales_invoice' or not is_car_cost_center(d.cost_center))
    union all
    -- A Car Invoice feeds two documents: the Delivery Note that hands the car
    -- over, and the Sales Return that takes it back.
    select c.id, c.contract_no, c.contract_date,
           (select p.name from parties p where p.id = c.customer_id),
           'CAR SALES', null,
           case when p_target_type = 'sales_return' then c.net_payable else c.sale_price end,
           1, 'car'
    from car_contracts c
    where p_target_type in ('delivery_note', 'sales_return')
      and c.company_id = auth_company_id()
      and c.status in ('active', 'completed')
      and not exists (
        select 1 from trade_documents t
        where t.company_id = c.company_id and t.doc_type = p_target_type and t.source_car_contract = c.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'doc_no', doc_no, 'doc_date', doc_date, 'party_name', party_name,
    'cost_center', cost_center, 'reference', reference, 'total', total,
    'lines', lines, 'source_kind', source_kind)
    order by doc_date desc, doc_no desc), '[]'::jsonb)
  from docs;
$function$;

-- ── and what the Load actually accepts ─────────────────────────────────────
-- The picker offering a document is not a permission to load it: the RPC takes
-- any id sent to it. It asks the same helper, against the same cost centre, so
-- the two cannot disagree.
create or replace function public.trade_doc_load(p_source uuid, p_target_type text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare d trade_documents; c car_contracts; v_src text; v_co uuid := auth_company_id();
        v_item text; v_prod uuid; v_veh car_vehicles;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  -- A Delivery Note and a Sales Return may both be raised from a Car Invoice.
  if p_target_type in ('delivery_note', 'sales_return') then
    select * into c from car_contracts where id = p_source and company_id = v_co;
    if found then
      if exists (select 1 from trade_documents t where t.company_id = v_co
                 and t.doc_type = p_target_type and t.source_car_contract = p_source) then
        raise exception 'Car Invoice % has already been loaded into a %.', c.contract_no, p_target_type;
      end if;
      select * into v_veh from car_vehicles where id = c.vehicle_id;
      select coalesce(p.name, concat_ws(' ', v_veh.make, v_veh.model, v_veh.model_year::text, v_veh.color), v_veh.vehicle_no)
        into v_item from acct_products p where p.id = v_veh.product_id;
      v_item := coalesce(v_item, concat_ws(' ', v_veh.make, v_veh.model, v_veh.model_year::text, v_veh.color), v_veh.vehicle_no);
      v_prod := v_veh.product_id;

      if p_target_type = 'sales_return' then
        if c.status not in ('active', 'completed') then
          raise exception 'Car Invoice % is %, so there is nothing to return.', c.contract_no, c.status;
        end if;
        -- The line comes across with the vehicle named and the RATE LEFT BLANK:
        -- what the car is worth coming back is typed, not derived.
        return jsonb_build_object(
          'id', c.id, 'doc_type', 'car_invoice', 'doc_no', c.contract_no, 'doc_date', current_date,
          'party_id', c.customer_id, 'cost_center', coalesce(c.cost_center, 'CAR SALES'), 'tag_area', c.tag_area,
          'reference', c.contract_no,
          'narration', 'Return of vehicle ' || coalesce(v_veh.vehicle_no, '') || ' against ' || c.contract_no,
          'terms', null, 'mode_of_payment', null, 'due_date', null, 'delivery_date', null, 'total', 0,
          'meta', jsonb_build_object('car_return', true, 'vehicle_no', v_veh.vehicle_no,
                                     'sold_for', c.net_payable, 'vehicle_cost', v_veh.total_cost,
                                     'update_stock', false),
          'source_kind', 'car',
          'lines', jsonb_build_array(jsonb_build_object(
            'product_id', v_prod, 'item_name', v_item, 'units', 'NOS',
            'quantity', 1, 'rate', 0, 'amount', 0, 'meta', '{}'::jsonb)));
      end if;

      return jsonb_build_object(
        'id', c.id, 'doc_type', 'car_invoice', 'doc_no', c.contract_no, 'doc_date', c.contract_date,
        'party_id', c.customer_id, 'cost_center', 'CAR SALES', 'tag_area', null,
        'reference', c.contract_no, 'narration', c.notes, 'terms', null, 'mode_of_payment', null,
        'due_date', null, 'delivery_date', c.delivery_date, 'total', c.sale_price,
        'meta', '{}'::jsonb, 'source_kind', 'car',
        'lines', jsonb_build_array(jsonb_build_object(
          'product_id', v_prod, 'item_name', v_item, 'units', 'NOS',
          'quantity', 1, 'rate', c.sale_price, 'amount', c.sale_price, 'meta', '{}'::jsonb)));
    end if;
  end if;

  select * into d from trade_documents where id = p_source and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;

  -- Resolved against the SOURCE's cost centre, which is the thing that decides
  -- whether this is a car. Looked up after the document is fetched for exactly
  -- that reason.
  v_src := trade_doc_source_type_for(p_target_type, d.cost_center);
  if v_src is null then raise exception 'This voucher is not loaded from another document.'; end if;
  if d.doc_type <> v_src then raise exception 'A % is loaded from a %, not from a %.', p_target_type, v_src, d.doc_type; end if;
  if exists (select 1 from trade_documents t where t.doc_type = p_target_type and t.source_doc_id = p_source
             and t.company_id = d.company_id) then
    raise exception '% % has already been loaded into a %.', v_src, d.doc_no, p_target_type;
  end if;

  return trade_doc_get(p_source) || jsonb_build_object('source_kind', 'trade');
end $function$;

-- The check runs AS A SIGNED-IN USER on purpose. workflow_source_type reads the
-- chain for auth_company_id(), and a migration has no session — so measured
-- bare, a perfectly correct "stock PV loads from an MRN" comes back null and the
-- assertion fails on working code. Caught by rehearsing it.
do $chk$
declare v_car text; v_stock text; v_car_mrn text; v_uid uuid;
begin
  select user_id into v_uid from user_roles where role = 'admin'::app_role limit 1;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  select trade_doc_source_type_for('purchase_voucher', 'CAR TRADING') into v_car;
  select trade_doc_source_type_for('purchase_voucher', 'VISTA TRANSPORT') into v_stock;
  select trade_doc_source_type_for('mrn', 'CAR TRADING') into v_car_mrn;

  perform set_config('role', 'postgres', true);
  if v_car <> 'purchase_order' then
    raise exception '349: a car PV should load from a Purchase Order, got %', coalesce(v_car, 'null');
  end if;
  if v_stock is distinct from 'mrn' then
    raise exception '349: a stock PV must still load from an MRN, got %', coalesce(v_stock, 'null');
  end if;
  if v_car_mrn is not null then
    raise exception '349: a car should have no MRN step, got %', v_car_mrn;
  end if;
end $chk$;

commit;
