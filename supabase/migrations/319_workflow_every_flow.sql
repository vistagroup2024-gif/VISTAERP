-- The Work Flow board covers the whole ERP, and you can change it.
--
-- Three things were wrong with it.
--
-- 1. IT ONLY KNEW SEVEN DOCUMENTS. Migration 307 seeded the sales/purchase
--    chain — Quotation, Sale Order, Sales Invoice, Delivery Note, Purchase
--    Order, MRN, Purchase Voucher — and nothing else. Every other voucher in
--    the ERP (the cash and bank vouchers, the journals, the module invoices,
--    payroll, the car documents) was simply absent, so the board was a picture
--    of one corner of the business rather than of the business.
--
-- 2. A STEP COULD ONLY BE LOADED FROM ONE PLACE. source_type is a single
--    column, so when a Delivery Note gained a second source — a Car Invoice,
--    alongside the Sales Invoice — the board had nowhere to put it and drew
--    only the Sales Invoice. The same is now true of the Sales Return, which
--    migration 318 taught to load a Car Invoice. That is a real second source
--    and the board was lying by omission.
--
-- 3. YOU COULD ONLY EDIT WHAT WAS ALREADY THERE. A step could be switched off
--    or re-sourced. It could not be added, renamed, moved, or removed, so a
--    flow the ERP did not ship with could not be described at all.
--
-- WHAT CHANGES
-- ------------
-- `module` groups the steps, so the board draws one chain per part of the
-- business instead of one tangle.
--
-- `alt_source_type` is the SECOND source. It is read-only on purpose: the car
-- routes are built into trade_doc_load and trade_doc_pending rather than
-- resolved from this table, so offering to edit it would be offering a control
-- that does nothing. It is here so the board tells the truth.
--
-- `is_custom` marks a step somebody added. Only those can be deleted — a step
-- the ERP ships with can be switched off, never removed, because a screen still
-- points at it.
--
-- workflow_source_type is untouched, so the Load button on every voucher
-- resolves exactly as it did. The seeded sources are the ones that are already
-- true today, including the two that are deliberately null (Sales Return and
-- Purchase Return are typed by hand, not loaded from the chain) — seeding those
-- with a plausible-looking source would have silently changed what their Load
-- lists offer.

alter table workflow_steps add column if not exists module     text not null default 'Sales & Purchase';
alter table workflow_steps add column if not exists alt_source_type text;
alter table workflow_steps add column if not exists is_custom  boolean not null default false;

comment on column workflow_steps.alt_source_type is
  'A second document this step can be raised from, built into the code rather than resolved from this table. Shown, not edited.';
comment on column workflow_steps.is_custom is
  'Added by a user rather than shipped with the ERP. Only these can be deleted.';

-- ------------------------------------------------------------- the modules --
-- The seven that were already here get their module and their second source.

update workflow_steps set module = 'Sales'    where doc_type in ('sales_quotation','sale_order','sales_invoice','delivery_note');
update workflow_steps set module = 'Purchase' where doc_type in ('purchase_order','mrn','purchase_voucher');
update workflow_steps set alt_source_type = 'car_invoice' where doc_type = 'delivery_note';

-- --------------------------------------------------------------- every step --
-- Everything else the ERP can raise. `enabled` is true so the board shows the
-- business as it stands; switch one off to take it off the board.

insert into workflow_steps (company_id, doc_type, label, module, source_type, alt_source_type, enabled, sort)
select c.id, s.doc_type, s.label, s.module, s.source_type, s.alt_source_type, true, s.sort
from companies c
cross join (values
  -- Sales. A Sales Return is typed, not loaded from the chain — except for a
  -- car, which is returned against the Car Invoice that sold it.
  ('sales_return',      'Sales Returns',          'Sales',            null,          'car_invoice', 45),

  -- Car Sales. The Car Invoice is raised from a Sale Order and is what a
  -- Delivery Note and a Sales Return are loaded from.
  ('car_invoice',       'Car Invoices',           'Car Sales',        'sale_order',  null,          80),
  ('car_expense',       'Car Expense Vouchers',   'Car Sales',        null,          null,          82),
  ('car_charges',       'Monthly Charges',        'Car Sales',        null,          null,          84),

  -- Purchase.
  ('purchase_return',   'Purchase Returns',       'Purchase',         null,          null,          75),
  ('supplier_bill',     'Supplier Bills',         'Purchase',         null,          null,          78),

  -- Cash and bank. None of these is loaded from another document: they are
  -- raised against a party or an account and settle whatever is open.
  ('gl_receipt',        'Receipts',               'Cash and Bank',    null,          null,          110),
  ('gl_payment',        'Payments',               'Cash and Bank',    null,          null,          120),
  ('gl_contra',         'Contra',                 'Cash and Bank',    null,          null,          130),
  ('gl_petty',          'Petty Cash',             'Cash and Bank',    null,          null,          140),
  ('gl_pdc',            'PDC Register',           'Cash and Bank',    null,          null,          150),

  -- Journals.
  ('gl_journal',        'Journal Entries',        'Journals',         null,          null,          210),
  ('invoice_bill',      'Bill Records',           'Journals',         null,          null,          220),
  ('gl_recurring',      'Recurring Vouchers',     'Journals',         null,          null,          230),

  -- Module invoicing. Each is raised from its own module's booking rather than
  -- from a trade document, which is why none of them has a source here.
  ('visa_invoice',      'Visa Invoices',          'Module Invoicing', null,          null,          310),
  ('transport_invoice', 'Transport Invoices',     'Module Invoicing', null,          null,          320),
  ('hotel_invoice',     'Hotel Invoices',         'Module Invoicing', null,          null,          330),

  -- Payroll and stock.
  ('gl_payroll',        'Payroll',                'Payroll / HR',     null,          null,          410),
  ('stock_documents',   'Document Processing',    'Inventory',        null,          null,          510),
  ('stock_indents',     'Indents',                'Inventory',        null,          null,          520)
) as s(doc_type, label, module, source_type, alt_source_type, sort)
on conflict (company_id, doc_type) do nothing;

-- ---------------------------------------------------------------- the list --

create or replace function workflow_steps_list()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'doc_type', w.doc_type, 'label', w.label, 'module', w.module,
    'source_type', w.source_type, 'alt_source_type', w.alt_source_type,
    'enabled', w.enabled, 'sort', w.sort, 'is_custom', w.is_custom,
    'is_trade', w.doc_type in ('sales_quotation','sale_order','sales_invoice','delivery_note',
                               'sales_return','purchase_order','mrn','purchase_voucher','purchase_return'),
    'documents', (select count(*) from trade_documents d
                  where d.company_id = w.company_id and d.doc_type = w.doc_type)
  ) order by w.module, w.sort), '[]'::jsonb)
  from workflow_steps w where w.company_id = auth_company_id() and is_staff();
$function$;

-- ---------------------------------------------------------------- the save --
-- The three original arguments keep their positions and everything added is
-- defaulted, so a caller that only sets the source and the switch still works.
--
-- The old three-argument form goes FIRST. Adding defaults makes a new overload
-- rather than replacing it, and while both exist a three-argument call matches
-- both and Postgres refuses it as ambiguous.
drop function if exists workflow_step_save(text, text, boolean);

create or replace function workflow_step_save(
  p_doc_type text, p_source text, p_enabled boolean,
  p_label text default null, p_module text default null, p_sort integer default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_co uuid := auth_company_id(); v_src text; i int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('workflow', 'edit');
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
    while v_walk is not null and i < 40 loop
      i := i + 1;
      if v_walk = p_doc_type then
        raise exception 'That would make the chain a circle';
      end if;
      select source_type into v_walk from workflow_steps where company_id = v_co and doc_type = v_walk;
    end loop;
  end;

  update workflow_steps
     set source_type = v_src,
         enabled = coalesce(p_enabled, true),
         label   = coalesce(nullif(btrim(coalesce(p_label,'')),''), label),
         module  = coalesce(nullif(btrim(coalesce(p_module,'')),''), module),
         sort    = coalesce(p_sort, sort)
   where company_id = v_co and doc_type = p_doc_type;
end $function$;

-- ----------------------------------------------------------------- the add --

create or replace function workflow_step_add(
  p_doc_type text, p_label text, p_module text default null,
  p_source text default null, p_sort integer default null)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare v_co uuid := auth_company_id(); v_key text; v_src text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('workflow', 'create');

  -- A key is a machine name, so it is normalised rather than taken as typed:
  -- two steps differing only by a capital letter would be two rows the chain
  -- could not tell apart.
  v_key := lower(regexp_replace(btrim(coalesce(p_doc_type, p_label, '')), '[^a-zA-Z0-9]+', '_', 'g'));
  v_key := btrim(v_key, '_');
  if v_key = '' then raise exception 'Give the step a name'; end if;
  if nullif(btrim(coalesce(p_label,'')),'') is null then raise exception 'Give the step a label'; end if;
  if exists (select 1 from workflow_steps where company_id = v_co and doc_type = v_key) then
    raise exception 'There is already a step called %', v_key;
  end if;

  v_src := nullif(btrim(coalesce(p_source,'')),'');
  if v_src is not null and not exists (select 1 from workflow_steps where company_id = v_co and doc_type = v_src) then
    raise exception 'Unknown workflow step %', v_src;
  end if;

  insert into workflow_steps(company_id, doc_type, label, module, source_type, enabled, sort, is_custom)
  values (v_co, v_key, btrim(p_label),
          coalesce(nullif(btrim(coalesce(p_module,'')),''), 'Other'),
          v_src, true,
          coalesce(p_sort, (select coalesce(max(sort), 0) + 10 from workflow_steps where company_id = v_co)),
          true);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'workflow_step_added', 'workflow_step', null,
          jsonb_build_object('doc_type', v_key, 'label', p_label, 'module', p_module, 'source', v_src));
  return v_key;
end $function$;

-- -------------------------------------------------------------- the delete --

create or replace function workflow_step_delete(p_doc_type text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_co uuid := auth_company_id(); w workflow_steps; v_kids text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('workflow', 'delete');

  select * into w from workflow_steps where company_id = v_co and doc_type = p_doc_type;
  if not found then raise exception 'Unknown workflow step %', p_doc_type; end if;

  -- A step the ERP ships with has a screen pointing at it. Switching it off
  -- takes it out of the chain; deleting it would leave that screen orphaned.
  if not w.is_custom then
    raise exception 'This step is part of the ERP. Switch it off instead — the chain closes up behind it.';
  end if;

  select string_agg(label, ', ' order by label) into v_kids
  from workflow_steps where company_id = v_co and source_type = p_doc_type;
  if v_kids is not null then
    raise exception 'Other steps are loaded from this one (%). Point them elsewhere first.', v_kids;
  end if;

  delete from workflow_steps where company_id = v_co and doc_type = p_doc_type;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'workflow_step_deleted', 'workflow_step', null,
          jsonb_build_object('doc_type', p_doc_type, 'label', w.label));
end $function$;

-- -------------------------------------------------------------- the board ---
-- Same shape as before, plus the module it belongs to and the second source it
-- can be raised from.

create or replace function workflow_summary()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with co as (select auth_company_id() as id),
  steps as (
    select w.* from workflow_steps w, co where w.company_id = co.id and w.enabled
  ),
  nxt as (
    select s.doc_type,
           (select n.doc_type from steps n
             where workflow_source_type((select id from co), n.doc_type) = s.doc_type
             order by n.sort limit 1) as next_type
    from steps s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'doc_type', s.doc_type, 'label', s.label, 'sort', s.sort, 'module', s.module,
    'source_type', workflow_source_type((select id from co), s.doc_type),
    'alt_source_type', s.alt_source_type,
    'alt_source_label', (select a.label from steps a where a.doc_type = s.alt_source_type),
    'is_custom', s.is_custom,
    'is_trade', s.doc_type in ('sales_quotation','sale_order','sales_invoice','delivery_note',
                               'sales_return','purchase_order','mrn','purchase_voucher','purchase_return'),
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
    ) order by s.module, s.sort), '[]'::jsonb)
  from steps s join nxt n on n.doc_type = s.doc_type;
$function$;

revoke all on function workflow_steps_list()                                  from public, anon;
revoke all on function workflow_step_save(text, text, boolean, text, text, integer) from public, anon;
revoke all on function workflow_step_add(text, text, text, text, integer)     from public, anon;
revoke all on function workflow_step_delete(text)                             from public, anon;
revoke all on function workflow_summary()                                     from public, anon;
grant execute on function workflow_steps_list()                                  to authenticated;
grant execute on function workflow_step_save(text, text, boolean, text, text, integer) to authenticated;
grant execute on function workflow_step_add(text, text, text, text, integer)     to authenticated;
grant execute on function workflow_step_delete(text)                             to authenticated;
grant execute on function workflow_summary()                                     to authenticated;
