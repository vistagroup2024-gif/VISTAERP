-- The document chain becomes data.
--
-- Which voucher is loaded from which used to be written down three times: a
-- CASE in trade_doc_source_type, a VALUES list in workflow_summary, and rows
-- laid out by hand in the board's JSX. Changing how the business works meant
-- editing three things and hoping they agreed. It lives in workflow_steps now
-- and nowhere else.

create table if not exists workflow_steps (
  company_id  uuid not null references companies(id) on delete cascade,
  doc_type    text not null,
  label       text not null,
  source_type text,
  enabled     boolean not null default true,
  sort        integer not null default 0,
  primary key (company_id, doc_type)
);

alter table workflow_steps enable row level security;
drop policy if exists workflow_steps_staff on workflow_steps;
create policy workflow_steps_staff on workflow_steps
  for all using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

-- The chain as it has always run, seeded for every company that has none.
insert into workflow_steps (company_id, doc_type, label, source_type, sort)
select c.id, s.doc_type, s.label, s.source_type, s.sort
from companies c
cross join (values
  ('sales_quotation', 'Sales Quotations',       null,              10),
  ('sale_order',      'Sale Orders',            'sales_quotation', 20),
  ('sales_invoice',   'Sales Invoices',         'sale_order',      30),
  ('delivery_note',   'Delivery Notes',         'sales_invoice',   40),
  ('purchase_order',  'Purchase Orders',        'sale_order',      50),
  ('mrn',             'Material Receipt Notes', 'purchase_order',  60),
  ('purchase_voucher','Purchase Vouchers',      'mrn',             70)
) as s(doc_type, label, source_type, sort)
on conflict (company_id, doc_type) do nothing;

-- Resolve a step's source THROUGH anything switched off, so turning a step off
-- closes the chain up rather than breaking it: switch off Material Receipt Note
-- and a Purchase Voucher loads straight from the Purchase Order.
create or replace function workflow_source_type(p_company uuid, p_target text)
returns text language plpgsql stable set search_path to 'public' as $function$
declare v_src text; v_on boolean; i int := 0;
begin
  select source_type into v_src from workflow_steps
   where company_id = p_company and doc_type = p_target;
  if not found then return null; end if;

  while v_src is not null and i < 20 loop
    i := i + 1;
    select enabled into v_on from workflow_steps
     where company_id = p_company and doc_type = v_src;
    if v_on is null then return v_src; end if;   -- not a configured step; take it as given
    exit when v_on;
    select source_type into v_src from workflow_steps
     where company_id = p_company and doc_type = v_src;
  end loop;
  return v_src;
end $function$;

-- The Load button on every voucher is a one-line wrapper over the definition.
create or replace function trade_doc_source_type(p_target text)
returns text language sql stable set search_path to 'public' as $function$
  select workflow_source_type(auth_company_id(), p_target);
$function$;

create or replace function workflow_steps_list()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'doc_type', w.doc_type, 'label', w.label, 'source_type', w.source_type,
    'enabled', w.enabled, 'sort', w.sort,
    'documents', (select count(*) from trade_documents d
                  where d.company_id = w.company_id and d.doc_type = w.doc_type)
  ) order by w.sort), '[]'::jsonb)
  from workflow_steps w where w.company_id = auth_company_id() and is_staff();
$function$;

create or replace function workflow_step_save(p_doc_type text, p_source text, p_enabled boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_co uuid := auth_company_id(); v_src text; i int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from workflow_steps where company_id = v_co and doc_type = p_doc_type) then
    raise exception 'Unknown workflow step %', p_doc_type;
  end if;
  v_src := nullif(btrim(coalesce(p_source,'')),'');
  if v_src = p_doc_type then raise exception 'A step cannot be loaded from itself'; end if;
  if v_src is not null and not exists (select 1 from workflow_steps where company_id = v_co and doc_type = v_src) then
    raise exception 'Unknown workflow step %', v_src;
  end if;

  -- Refuse a circle rather than store one: workflow_source_type would spin, and
  -- every Load button in the ERP goes through it.
  declare v_walk text := v_src; begin
    while v_walk is not null and i < 20 loop
      i := i + 1;
      if v_walk = p_doc_type then
        raise exception 'That would make the chain a circle';
      end if;
      select source_type into v_walk from workflow_steps where company_id = v_co and doc_type = v_walk;
    end loop;
  end;

  update workflow_steps
     set source_type = v_src, enabled = coalesce(p_enabled, true)
   where company_id = v_co and doc_type = p_doc_type;
end $function$;

-- The board draws itself from the same table.
create or replace function workflow_summary()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with co as (select auth_company_id() as id),
  steps as (
    select w.* from workflow_steps w, co where w.company_id = co.id and w.enabled
  ),
  -- The step that loads FROM this one, once disabled steps are skipped over.
  nxt as (
    select s.doc_type,
           (select n.doc_type from steps n
             where workflow_source_type((select id from co), n.doc_type) = s.doc_type
             order by n.sort limit 1) as next_type
    from steps s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'doc_type', s.doc_type, 'label', s.label, 'sort', s.sort,
    'source_type', workflow_source_type((select id from co), s.doc_type),
    'next_type', n.next_type,
    'total', (select count(*) from trade_documents d
              where d.company_id = (select id from co) and d.doc_type = s.doc_type),
    'pending', case when n.next_type is null then null else (
      select count(*) from trade_documents d
      where d.company_id = (select id from co) and d.doc_type = s.doc_type
        and coalesce(d.status,'open') not in ('cancelled','closed')
        and not exists (select 1 from trade_documents x
                        where x.company_id = d.company_id and x.doc_type = n.next_type
                          and x.source_doc_id = d.id)) end,
    -- A Sale Order is pending twice over: once for its purchase side and once
    -- for its sales side. Both are only counted while those steps are on.
    'pending_po', case when s.doc_type <> 'sale_order'
        or not exists (select 1 from steps where doc_type = 'purchase_order') then null else (
      select count(*) from trade_documents d
      where d.company_id = (select id from co) and d.doc_type = 'sale_order'
        and coalesce(d.status,'open') not in ('cancelled','closed')
        and not exists (select 1 from trade_documents x
                        where x.company_id = d.company_id and x.doc_type = 'purchase_order' and x.source_doc_id = d.id)) end,
    'pending_invoice', case when s.doc_type <> 'sale_order'
        or not exists (select 1 from steps where doc_type = 'sales_invoice') then null else (
      select count(*) from trade_documents d
      where d.company_id = (select id from co) and d.doc_type = 'sale_order'
        and coalesce(d.status,'open') not in ('cancelled','closed')
        and not exists (select 1 from trade_documents x
                        where x.company_id = d.company_id and x.doc_type = 'sales_invoice' and x.source_doc_id = d.id)
        and not exists (select 1 from car_contracts c
                        where c.company_id = d.company_id and c.source_doc_id = d.id)) end
    ) order by s.sort), '[]'::jsonb)
  from steps s join nxt n on n.doc_type = s.doc_type;
$function$;

revoke all on function workflow_source_type(uuid, text)     from public, anon;
revoke all on function trade_doc_source_type(text)          from public, anon;
revoke all on function workflow_steps_list()                from public, anon;
revoke all on function workflow_step_save(text, text, boolean) from public, anon;
revoke all on function workflow_summary()                   from public, anon;
grant execute on function workflow_source_type(uuid, text)     to authenticated;
grant execute on function trade_doc_source_type(text)          to authenticated;
grant execute on function workflow_steps_list()                to authenticated;
grant execute on function workflow_step_save(text, text, boolean) to authenticated;
grant execute on function workflow_summary()                   to authenticated;
