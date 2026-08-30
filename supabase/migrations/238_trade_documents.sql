-- 238_trade_documents.sql
-- Accounting Phase 3 — foundation for the grid-style "trade" vouchers that share
-- the same shape (header + item lines): Purchase Order, Purchase Voucher,
-- Purchase Return, MRN, Sales Quotation, Sale Order, Sales Return, Delivery Note.
-- These are documents (not GL postings) at this stage — GL/inventory posting is
-- layered on later. One table pair with a doc_type discriminator + generic RPCs
-- keeps every voucher on one consistent, auditable engine.
create table if not exists trade_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  doc_type text not null,
  doc_no text not null,
  doc_date date not null default current_date,
  party_id uuid references parties(id),
  cost_center text,
  tag_area text,
  reference text,
  narration text,
  terms text,
  mode_of_payment text,
  due_date date,
  delivery_date date,
  currency char(3) not null default 'SAR',
  round_off numeric(18,2) not null default 0,
  subtotal numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  status text not null default 'open',
  meta jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_trade_docs_type on trade_documents(company_id, doc_type, doc_no);

create table if not exists trade_document_lines (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references trade_documents(id) on delete cascade,
  sort int not null default 0,
  product_id uuid references acct_products(id),
  item_name text,
  units text,
  quantity numeric(18,3) not null default 0,
  rate numeric(18,2) not null default 0,
  amount numeric(18,2) not null default 0,
  link1 text,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists idx_trade_doc_lines on trade_document_lines(doc_id);

alter table trade_documents enable row level security;
alter table trade_document_lines enable row level security;
drop policy if exists trade_documents_staff on trade_documents;
create policy trade_documents_staff on trade_documents for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());
drop policy if exists trade_document_lines_staff on trade_document_lines;
create policy trade_document_lines_staff on trade_document_lines for all to authenticated
  using (exists (select 1 from trade_documents d where d.id = doc_id and d.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from trade_documents d where d.id = doc_id and d.company_id = auth_company_id() and is_staff()));

-- Save (create or edit) a trade document with its lines. p_prefix seeds the doc
-- number sequence for this type on first use (e.g. 'PO-', 'SO-').
create or replace function trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0; v_sub numeric(18,2) := 0; v_round numeric(18,2);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
  select coalesce(sum(round(coalesce((x->>'amount')::numeric,0),2)), 0) into v_sub
    from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x;

  if v_id is null then
    insert into doc_sequences(company_id, doc_type, prefix)
      values (v_co, 'trade_'||p_type, coalesce(nullif(p_prefix,''), upper(left(p_type,3))||'-'))
      on conflict (company_id, doc_type) do nothing;
    v_no := next_doc_number(v_co, 'trade_'||p_type);
    insert into trade_documents(company_id, doc_type, doc_no, doc_date, party_id, cost_center, tag_area, reference,
      narration, terms, mode_of_payment, due_date, delivery_date, currency, round_off, subtotal, total, status, meta, created_by)
    values (v_co, p_type, v_no,
      coalesce(nullif(p_header->>'doc_date','')::date, current_date), nullif(p_header->>'party_id','')::uuid,
      nullif(p_header->>'cost_center',''), nullif(p_header->>'tag_area',''), nullif(p_header->>'reference',''),
      nullif(p_header->>'narration',''), nullif(p_header->>'terms',''), nullif(p_header->>'mode_of_payment',''),
      nullif(p_header->>'due_date','')::date, nullif(p_header->>'delivery_date','')::date,
      coalesce(nullif(p_header->>'currency',''),'SAR'), v_round, v_sub, v_sub + v_round,
      coalesce(nullif(p_header->>'status',''),'open'), coalesce(p_header->'meta','{}'::jsonb), auth.uid())
    returning id, doc_no into v_id, v_no;
  else
    update trade_documents set
      doc_date = coalesce(nullif(p_header->>'doc_date','')::date, current_date), party_id = nullif(p_header->>'party_id','')::uuid,
      cost_center = nullif(p_header->>'cost_center',''), tag_area = nullif(p_header->>'tag_area',''), reference = nullif(p_header->>'reference',''),
      narration = nullif(p_header->>'narration',''), terms = nullif(p_header->>'terms',''), mode_of_payment = nullif(p_header->>'mode_of_payment',''),
      due_date = nullif(p_header->>'due_date','')::date, delivery_date = nullif(p_header->>'delivery_date','')::date,
      currency = coalesce(nullif(p_header->>'currency',''),'SAR'), round_off = v_round, subtotal = v_sub, total = v_sub + v_round,
      meta = coalesce(p_header->'meta','{}'::jsonb), updated_at = now()
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

create or replace function trade_doc_get(p_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select case when d.id is null then null else jsonb_build_object(
    'id', d.id, 'doc_type', d.doc_type, 'doc_no', d.doc_no, 'doc_date', d.doc_date, 'party_id', d.party_id,
    'party_name', (select name from parties p where p.id = d.party_id),
    'cost_center', d.cost_center, 'tag_area', d.tag_area, 'reference', d.reference, 'narration', d.narration,
    'terms', d.terms, 'mode_of_payment', d.mode_of_payment, 'due_date', d.due_date, 'delivery_date', d.delivery_date,
    'currency', d.currency, 'round_off', d.round_off, 'subtotal', d.subtotal, 'total', d.total, 'status', d.status, 'meta', d.meta,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', l.product_id, 'item_name', l.item_name, 'units', l.units, 'quantity', l.quantity,
        'rate', l.rate, 'amount', l.amount, 'link1', l.link1, 'meta', l.meta) order by l.sort)
      from trade_document_lines l where l.doc_id = d.id), '[]'::jsonb)
  ) end
  from trade_documents d where d.id = p_id and d.company_id = auth_company_id();
$function$;

create or replace function trade_doc_find(p_type text, p_no text)
 returns uuid language sql stable security definer set search_path to 'public'
as $function$
  select id from trade_documents where company_id = auth_company_id() and doc_type = p_type and doc_no = btrim(p_no)
  order by created_at desc limit 1;
$function$;

create or replace function trade_doc_nav(p_type text, p_id uuid, p_dir text)
 returns uuid language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_no text; v_id uuid; v_co uuid := auth_company_id();
begin
  if p_id is not null then select doc_no into v_no from trade_documents where id = p_id and company_id = v_co; end if;
  if p_dir = 'prev' then
    select id into v_id from trade_documents where company_id = v_co and doc_type = p_type and (v_no is null or doc_no < v_no)
      order by doc_no desc limit 1;
  else
    select id into v_id from trade_documents where company_id = v_co and doc_type = p_type and (v_no is null or doc_no > v_no)
      order by doc_no asc limit 1;
  end if;
  return v_id;
end $function$;

create or replace function trade_doc_delete(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  delete from trade_documents where id = p_id and company_id = auth_company_id();
  if not found then raise exception 'Document not found'; end if;
end $function$;

grant execute on function trade_doc_save(text, text, uuid, jsonb, jsonb) to authenticated;
grant execute on function trade_doc_get(uuid) to authenticated;
grant execute on function trade_doc_find(text, text) to authenticated;
grant execute on function trade_doc_nav(text, uuid, text) to authenticated;
grant execute on function trade_doc_delete(uuid) to authenticated;
