-- 279_workflow_fixes.sql
-- Two gaps found reviewing the workflow.
--
--  1. A Delivery Note could only be loaded from a Sales Invoice. The car branch
--     ends in a Car Invoice, and that is delivered too — the Load list now
--     offers both, and a Delivery Note remembers which one it came from.
--  2. A Sales Invoice on a car cost centre is refused. Cars leave stock one
--     vehicle at a time, with the car's own status; a Sales Invoice would post
--     revenue against a car whose stock never moves. Car sale orders are
--     already kept out of that Load list, but nothing stopped one being typed.

alter table trade_documents add column if not exists source_car_contract uuid references car_contracts(id) on delete set null;
create index if not exists idx_trade_documents_source_car on trade_documents(source_car_contract);

-- ---------------------------------------------------------------------------
-- 1. The Delivery Note's Load list: unloaded Sales Invoices AND unloaded Car
--    Invoices, each row saying which it is so the loader knows where to read.
-- ---------------------------------------------------------------------------
create or replace function trade_doc_pending(p_target_type text)
returns jsonb language sql stable security definer set search_path = public as $$
  with docs as (
    select d.id, d.doc_no, d.doc_date,
           (select p.name from parties p where p.id = d.party_id) party_name,
           d.cost_center, d.reference, d.total,
           (select count(*) from trade_document_lines l where l.doc_id = d.id) lines,
           'trade' as source_kind
    from trade_documents d
    where d.company_id = auth_company_id()
      and d.doc_type = trade_doc_source_type(p_target_type)
      and coalesce(d.status, 'open') not in ('cancelled', 'closed')
      and not exists (
        select 1 from trade_documents t
        where t.company_id = d.company_id and t.doc_type = p_target_type and t.source_doc_id = d.id)
      -- A car sale order goes to a Car Invoice, not to a Sales Invoice.
      and (p_target_type <> 'sales_invoice' or not is_car_cost_center(d.cost_center))
    union all
    -- Car Invoices waiting to be delivered.
    select c.id, c.contract_no, c.contract_date,
           (select p.name from parties p where p.id = c.customer_id),
           'CAR SALES', null, c.sale_price, 1, 'car'
    from car_contracts c
    where p_target_type = 'delivery_note'
      and c.company_id = auth_company_id()
      and c.status in ('active', 'completed')
      and not exists (
        select 1 from trade_documents t
        where t.company_id = c.company_id and t.doc_type = 'delivery_note' and t.source_car_contract = c.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'doc_no', doc_no, 'doc_date', doc_date, 'party_name', party_name,
    'cost_center', cost_center, 'reference', reference, 'total', total,
    'lines', lines, 'source_kind', source_kind)
    order by doc_date desc, doc_no desc), '[]'::jsonb)
  from docs;
$$;

-- Loading understands both: a trade document, or a Car Invoice on its way to a
-- Delivery Note. The car payload is shaped like a document so the voucher fills
-- itself in exactly the same way.
create or replace function trade_doc_load(p_source uuid, p_target_type text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d trade_documents; c car_contracts; v_src text; v_co uuid := auth_company_id(); v_item text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  -- A Delivery Note may be raised from a Car Invoice.
  if p_target_type = 'delivery_note' then
    select * into c from car_contracts where id = p_source and company_id = v_co;
    if found then
      if exists (select 1 from trade_documents t where t.company_id = v_co
                 and t.doc_type = 'delivery_note' and t.source_car_contract = p_source) then
        raise exception 'Car Invoice % has already been delivered.', c.contract_no;
      end if;
      select coalesce(p.name, concat_ws(' ', v.make, v.model, v.model_year::text, v.color), v.vehicle_no)
        into v_item
        from car_vehicles v left join acct_products p on p.id = v.product_id
        where v.id = c.vehicle_id;
      return jsonb_build_object(
        'id', c.id, 'doc_type', 'car_invoice', 'doc_no', c.contract_no, 'doc_date', c.contract_date,
        'party_id', c.customer_id, 'cost_center', 'CAR SALES', 'tag_area', null,
        'reference', c.contract_no, 'narration', c.notes, 'terms', null, 'mode_of_payment', null,
        'due_date', null, 'delivery_date', c.delivery_date, 'total', c.sale_price,
        'meta', '{}'::jsonb, 'source_kind', 'car',
        'lines', jsonb_build_array(jsonb_build_object(
          'product_id', (select v.product_id from car_vehicles v where v.id = c.vehicle_id),
          'item_name', coalesce(v_item, 'Vehicle'), 'units', 'NOS',
          'quantity', 1, 'rate', c.sale_price, 'amount', c.sale_price, 'meta', '{}'::jsonb)));
    end if;
  end if;

  v_src := trade_doc_source_type(p_target_type);
  if v_src is null then raise exception 'This voucher is not loaded from another document.'; end if;

  select * into d from trade_documents where id = p_source and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.doc_type <> v_src then raise exception 'A % is loaded from a %, not from a %.', p_target_type, v_src, d.doc_type; end if;
  if exists (select 1 from trade_documents t where t.doc_type = p_target_type and t.source_doc_id = p_source
             and t.company_id = d.company_id) then
    raise exception '% % has already been loaded into a %.', v_src, d.doc_no, p_target_type;
  end if;

  return trade_doc_get(p_source) || jsonb_build_object('source_kind', 'trade');
end $$;

-- ---------------------------------------------------------------------------
-- trade_doc_save: carry the car link too, with the same one-to-one guard, and
-- refuse a Sales Invoice on a car cost centre.
-- ---------------------------------------------------------------------------
create or replace function trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0;
        v_sub numeric(18,2) := 0; v_round numeric(18,2); v_src uuid; v_car uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
  v_src := nullif(p_header->>'source_doc_id','')::uuid;
  v_car := nullif(p_header->>'source_car_contract','')::uuid;
  select coalesce(sum(round(coalesce((x->>'amount')::numeric,0),2)), 0) into v_sub
    from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x;

  -- Cars leave stock one vehicle at a time, driven by the car's own status, so
  -- a Sales Invoice would book revenue against stock that never moves.
  if p_type = 'sales_invoice' and is_car_cost_center(p_header->>'cost_center') then
    raise exception 'A car sale is invoiced in Car Sales, not with a Sales Invoice.';
  end if;

  if v_src is not null and exists (
      select 1 from trade_documents t
      where t.company_id = v_co and t.doc_type = p_type and t.source_doc_id = v_src
        and (v_id is null or t.id <> v_id)) then
    raise exception 'That document has already been loaded into another %.', p_type;
  end if;
  if v_car is not null and exists (
      select 1 from trade_documents t
      where t.company_id = v_co and t.doc_type = p_type and t.source_car_contract = v_car
        and (v_id is null or t.id <> v_id)) then
    raise exception 'That Car Invoice has already been loaded into another %.', p_type;
  end if;

  if v_id is null then
    insert into doc_sequences(company_id, doc_type, prefix)
      values (v_co, 'trade_'||p_type, coalesce(nullif(p_prefix,''), upper(left(p_type,3))||'-'))
      on conflict (company_id, doc_type) do nothing;
    v_no := next_doc_number(v_co, 'trade_'||p_type);
    insert into trade_documents(company_id, doc_type, doc_no, doc_date, party_id, cost_center, tag_area, reference,
      narration, terms, mode_of_payment, due_date, delivery_date, currency, round_off, subtotal, total, status, meta,
      source_doc_id, source_car_contract, created_by)
    values (v_co, p_type, v_no,
      coalesce(nullif(p_header->>'doc_date','')::date, current_date), nullif(p_header->>'party_id','')::uuid,
      nullif(p_header->>'cost_center',''), nullif(p_header->>'tag_area',''), nullif(p_header->>'reference',''),
      nullif(p_header->>'narration',''), nullif(p_header->>'terms',''), nullif(p_header->>'mode_of_payment',''),
      nullif(p_header->>'due_date','')::date, nullif(p_header->>'delivery_date','')::date,
      coalesce(nullif(p_header->>'currency',''),'SAR'), v_round, v_sub, v_sub + v_round,
      coalesce(nullif(p_header->>'status',''),'open'), coalesce(p_header->'meta','{}'::jsonb), v_src, v_car, auth.uid())
    returning id, doc_no into v_id, v_no;
  else
    update trade_documents set
      doc_date = coalesce(nullif(p_header->>'doc_date','')::date, current_date), party_id = nullif(p_header->>'party_id','')::uuid,
      cost_center = nullif(p_header->>'cost_center',''), tag_area = nullif(p_header->>'tag_area',''), reference = nullif(p_header->>'reference',''),
      narration = nullif(p_header->>'narration',''), terms = nullif(p_header->>'terms',''), mode_of_payment = nullif(p_header->>'mode_of_payment',''),
      due_date = nullif(p_header->>'due_date','')::date, delivery_date = nullif(p_header->>'delivery_date','')::date,
      currency = coalesce(nullif(p_header->>'currency',''),'SAR'), round_off = v_round, subtotal = v_sub, total = v_sub + v_round,
      meta = coalesce(p_header->'meta','{}'::jsonb),
      source_doc_id = coalesce(v_src, source_doc_id), source_car_contract = coalesce(v_car, source_car_contract),
      updated_at = now()
    where id = v_id and company_id = v_co;
    if not found then raise exception 'Document not found'; end if;
    select doc_no into v_no from trade_documents where id = v_id;
    delete from trade_document_lines where doc_id = v_id;
  end if;

  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    i := i + 1;
    if coalesce(nullif(ln->>'item_name',''), nullif(ln->>'product_id','')) is null and round(coalesce((ln->>'amount')::numeric,0),2) = 0 then continue; end if;
    insert into trade_document_lines(doc_id, sort, product_id, item_name, units, quantity, rate, amount, link1, meta)
    values (v_id, i, nullif(ln->>'product_id','')::uuid, nullif(ln->>'item_name',''), nullif(ln->>'units',''),
      round(coalesce((ln->>'quantity')::numeric,0),3), round(coalesce((ln->>'rate')::numeric,0),2),
      round(coalesce((ln->>'amount')::numeric,0),2), nullif(ln->>'link1',''), coalesce(ln->'meta','{}'::jsonb));
  end loop;

  return jsonb_build_object('id', v_id, 'doc_no', v_no);
end $function$;

-- A document opened later still shows the Car Invoice it was delivered against.
create or replace function trade_doc_get(p_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select case when d.id is null then null else jsonb_build_object(
    'id', d.id, 'doc_type', d.doc_type, 'doc_no', d.doc_no, 'doc_date', d.doc_date, 'party_id', d.party_id,
    'party_name', (select name from parties p where p.id = d.party_id),
    'cost_center', d.cost_center, 'tag_area', d.tag_area, 'reference', d.reference, 'narration', d.narration,
    'terms', d.terms, 'mode_of_payment', d.mode_of_payment, 'due_date', d.due_date, 'delivery_date', d.delivery_date,
    'currency', d.currency, 'round_off', d.round_off, 'subtotal', d.subtotal, 'total', d.total, 'status', d.status, 'meta', d.meta,
    'gl_entry', d.gl_entry, 'warehouse_id', d.warehouse_id,
    'source_doc_id', d.source_doc_id, 'source_car_contract', d.source_car_contract,
    'source_doc_no', coalesce(
      (select s.doc_no from trade_documents s where s.id = d.source_doc_id),
      (select c.contract_no from car_contracts c where c.id = d.source_car_contract)),
    'source_doc_type', (select s.doc_type from trade_documents s where s.id = d.source_doc_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', l.product_id, 'item_name', l.item_name, 'units', l.units, 'quantity', l.quantity,
        'rate', l.rate, 'amount', l.amount, 'link1', l.link1, 'meta', l.meta) order by l.sort)
      from trade_document_lines l where l.doc_id = d.id), '[]'::jsonb)
  ) end
  from trade_documents d where d.id = p_id and d.company_id = auth_company_id();
$function$;
