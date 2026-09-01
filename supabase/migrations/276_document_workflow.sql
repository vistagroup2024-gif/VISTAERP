-- 276_document_workflow.sql
-- The document workflow: Sales Quotation → Sale Order → (Car Invoice | Sales
-- Invoice | Purchase Order) → … , each voucher LOADED from the one before it so
-- the operator types the least possible.
--
--   Sales Quotation ─▶ Sale Order ─┬─▶ Purchase Order ─▶ MRN ─▶ Purchase Voucher
--                                  ├─▶ Sales Invoice ─▶ Delivery Note
--                                  └─▶ Car Invoice    ─▶ Delivery Note
--
-- A document is PENDING for a step while nothing downstream has loaded it, which
-- is exactly what the workflow screen counts. Loading is one-to-one: once a
-- quotation has become a sale order it drops off the pending list.

alter table trade_documents add column if not exists source_doc_id uuid references trade_documents(id) on delete set null;
create index if not exists idx_trade_documents_source on trade_documents(source_doc_id);
create index if not exists idx_trade_documents_type on trade_documents(company_id, doc_type, doc_date);

-- Where each voucher may be loaded from. One row per edge of the chain above,
-- so the rule lives in one place instead of being spelled out in each function.
create or replace function trade_doc_source_type(p_target text)
returns text language sql immutable as $$
  select case p_target
    when 'sale_order'       then 'sales_quotation'
    when 'purchase_order'   then 'sale_order'
    when 'mrn'              then 'purchase_order'
    when 'purchase_voucher' then 'mrn'
    when 'sales_invoice'    then 'sale_order'
    when 'delivery_note'    then 'sales_invoice'
    else null end;
$$;

create or replace function is_car_cost_center(p_cc text)
returns boolean language sql immutable as $$
  select upper(btrim(coalesce(p_cc, ''))) in ('CAR SALES INSTALLMENT', 'CAR TRADING');
$$;

-- ---------------------------------------------------------------------------
-- The Load list: upstream documents nothing has loaded yet.
-- ---------------------------------------------------------------------------
create or replace function trade_doc_pending(p_target_type text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
    'party_name', (select p.name from parties p where p.id = d.party_id),
    'cost_center', d.cost_center, 'reference', d.reference, 'total', d.total,
    'lines', (select count(*) from trade_document_lines l where l.doc_id = d.id))
    order by d.doc_date desc, d.doc_no desc), '[]'::jsonb)
  from trade_documents d
  where d.company_id = auth_company_id()
    and d.doc_type = trade_doc_source_type(p_target_type)
    and coalesce(d.status, 'open') not in ('cancelled', 'closed')
    and not exists (
      select 1 from trade_documents t
      where t.company_id = d.company_id and t.doc_type = p_target_type and t.source_doc_id = d.id)
    -- A car sale order goes to a Car Invoice, not to a Sales Invoice, and the
    -- other way about: keep each list to the vouchers it can actually feed.
    and (p_target_type <> 'sales_invoice' or not is_car_cost_center(d.cost_center));
$$;

-- Everything the target voucher needs to fill itself in, plus a guard: the
-- chain must allow it and nothing may have loaded the source already.
create or replace function trade_doc_load(p_source uuid, p_target_type text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d trade_documents; v_src text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_src := trade_doc_source_type(p_target_type);
  if v_src is null then raise exception 'This voucher is not loaded from another document.'; end if;

  select * into d from trade_documents where id = p_source and company_id = auth_company_id();
  if not found then raise exception 'Document not found'; end if;
  if d.doc_type <> v_src then raise exception 'A % is loaded from a %, not from a %.', p_target_type, v_src, d.doc_type; end if;
  if exists (select 1 from trade_documents t where t.doc_type = p_target_type and t.source_doc_id = p_source
             and t.company_id = d.company_id) then
    raise exception '% % has already been loaded into a %.', v_src, d.doc_no, p_target_type;
  end if;

  return trade_doc_get(p_source);
end $$;

-- ---------------------------------------------------------------------------
-- trade_doc_save carries the link, and refuses to load one source twice — the
-- list is a moment old by the time it is clicked, so the check belongs here.
-- ---------------------------------------------------------------------------
create or replace function trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0;
        v_sub numeric(18,2) := 0; v_round numeric(18,2); v_src uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
  v_src := nullif(p_header->>'source_doc_id','')::uuid;
  select coalesce(sum(round(coalesce((x->>'amount')::numeric,0),2)), 0) into v_sub
    from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x;

  if v_src is not null and exists (
      select 1 from trade_documents t
      where t.company_id = v_co and t.doc_type = p_type and t.source_doc_id = v_src
        and (v_id is null or t.id <> v_id)) then
    raise exception 'That document has already been loaded into another %.', p_type;
  end if;

  if v_id is null then
    insert into doc_sequences(company_id, doc_type, prefix)
      values (v_co, 'trade_'||p_type, coalesce(nullif(p_prefix,''), upper(left(p_type,3))||'-'))
      on conflict (company_id, doc_type) do nothing;
    v_no := next_doc_number(v_co, 'trade_'||p_type);
    insert into trade_documents(company_id, doc_type, doc_no, doc_date, party_id, cost_center, tag_area, reference,
      narration, terms, mode_of_payment, due_date, delivery_date, currency, round_off, subtotal, total, status, meta,
      source_doc_id, created_by)
    values (v_co, p_type, v_no,
      coalesce(nullif(p_header->>'doc_date','')::date, current_date), nullif(p_header->>'party_id','')::uuid,
      nullif(p_header->>'cost_center',''), nullif(p_header->>'tag_area',''), nullif(p_header->>'reference',''),
      nullif(p_header->>'narration',''), nullif(p_header->>'terms',''), nullif(p_header->>'mode_of_payment',''),
      nullif(p_header->>'due_date','')::date, nullif(p_header->>'delivery_date','')::date,
      coalesce(nullif(p_header->>'currency',''),'SAR'), v_round, v_sub, v_sub + v_round,
      coalesce(nullif(p_header->>'status',''),'open'), coalesce(p_header->'meta','{}'::jsonb), v_src, auth.uid())
    returning id, doc_no into v_id, v_no;
  else
    update trade_documents set
      doc_date = coalesce(nullif(p_header->>'doc_date','')::date, current_date), party_id = nullif(p_header->>'party_id','')::uuid,
      cost_center = nullif(p_header->>'cost_center',''), tag_area = nullif(p_header->>'tag_area',''), reference = nullif(p_header->>'reference',''),
      narration = nullif(p_header->>'narration',''), terms = nullif(p_header->>'terms',''), mode_of_payment = nullif(p_header->>'mode_of_payment',''),
      due_date = nullif(p_header->>'due_date','')::date, delivery_date = nullif(p_header->>'delivery_date','')::date,
      currency = coalesce(nullif(p_header->>'currency',''),'SAR'), round_off = v_round, subtotal = v_sub, total = v_sub + v_round,
      meta = coalesce(p_header->'meta','{}'::jsonb), source_doc_id = coalesce(v_src, source_doc_id), updated_at = now()
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

-- trade_doc_get hands back the link and the document it came from, so a voucher
-- opened later still shows what it was loaded from.
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
    'source_doc_id', d.source_doc_id,
    'source_doc_no', (select s.doc_no from trade_documents s where s.id = d.source_doc_id),
    'source_doc_type', (select s.doc_type from trade_documents s where s.id = d.source_doc_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', l.product_id, 'item_name', l.item_name, 'units', l.units, 'quantity', l.quantity,
        'rate', l.rate, 'amount', l.amount, 'link1', l.link1, 'meta', l.meta) order by l.sort)
      from trade_document_lines l where l.doc_id = d.id), '[]'::jsonb)
  ) end
  from trade_documents d where d.id = p_id and d.company_id = auth_company_id();
$function$;

grant execute on function trade_doc_source_type(text) to authenticated;
grant execute on function is_car_cost_center(text) to authenticated;
grant execute on function trade_doc_pending(text) to authenticated;
grant execute on function trade_doc_load(uuid, text) to authenticated;

-- A Car Invoice can be raised from a Sale Order too.
alter table car_contracts add column if not exists source_doc_id uuid references trade_documents(id) on delete set null;
create index if not exists idx_car_contracts_source on car_contracts(source_doc_id);

-- ---------------------------------------------------------------------------
-- The workflow screen: how many of each document, and how many are still
-- waiting to be carried to the next step.
-- ---------------------------------------------------------------------------
create or replace function workflow_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with types as (
    select * from (values
      ('sales_quotation',  'Sales Quotations',  'sale_order'),
      ('sale_order',       'Sale Orders',       null),
      ('sales_invoice',    'Sales Invoices',    'delivery_note'),
      ('delivery_note',    'Delivery Notes',    null),
      ('purchase_order',   'Purchase Orders',   'mrn'),
      ('mrn',              'Material Receipt Notes', 'purchase_voucher'),
      ('purchase_voucher', 'Purchase Vouchers', null)
    ) t(doc_type, label, next_type)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'doc_type', t.doc_type, 'label', t.label,
    'total', (select count(*) from trade_documents d
              where d.company_id = auth_company_id() and d.doc_type = t.doc_type),
    'pending', case when t.next_type is null then null else (
      select count(*) from trade_documents d
      where d.company_id = auth_company_id() and d.doc_type = t.doc_type
        and coalesce(d.status,'open') not in ('cancelled','closed')
        and not exists (select 1 from trade_documents x
                        where x.company_id = d.company_id and x.doc_type = t.next_type and x.source_doc_id = d.id)) end,
    -- A Sale Order is pending twice over: once for its purchase side and once
    -- for its sales side, which is what "Pending Sor - Por" counts.
    'pending_po', case when t.doc_type <> 'sale_order' then null else (
      select count(*) from trade_documents d
      where d.company_id = auth_company_id() and d.doc_type = 'sale_order'
        and coalesce(d.status,'open') not in ('cancelled','closed')
        and not exists (select 1 from trade_documents x
                        where x.company_id = d.company_id and x.doc_type = 'purchase_order' and x.source_doc_id = d.id)) end,
    'pending_invoice', case when t.doc_type <> 'sale_order' then null else (
      select count(*) from trade_documents d
      where d.company_id = auth_company_id() and d.doc_type = 'sale_order'
        and coalesce(d.status,'open') not in ('cancelled','closed')
        and not exists (select 1 from trade_documents x
                        where x.company_id = d.company_id and x.doc_type = 'sales_invoice' and x.source_doc_id = d.id)
        and not exists (select 1 from car_contracts c
                        where c.company_id = d.company_id and c.source_doc_id = d.id)) end
    ) order by t.doc_type), '[]'::jsonb)
  from types t;
$$;
grant execute on function workflow_summary() to authenticated;

-- Journal number prefix for the new voucher (see migration 263: every gl_trade_*
-- type otherwise falls back to the same 'GL_-' and the second one to post dies
-- on the entry-number unique index).
insert into doc_sequences(company_id, doc_type, prefix)
select c.id, 'gl_trade_sales_invoice', 'JSI-' from companies c
on conflict (company_id, doc_type) do nothing;
update doc_sequences set prefix = 'JSI-' where doc_type = 'gl_trade_sales_invoice' and prefix = 'GL_-';
