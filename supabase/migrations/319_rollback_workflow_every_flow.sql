-- ROLLBACK for 319_workflow_every_flow.sql.
--
-- Puts the board back to the seven-step sales/purchase chain, with one source
-- per step and no way to add or remove one.
--
-- The steps 319 seeded are DELETED, and so is anything a user added. That is
-- safe — a workflow step is a description of the chain, not a document, and no
-- voucher references one — but it does mean a chain somebody configured is
-- lost. Check what would go first:
--
--     select doc_type, label, module, is_custom from workflow_steps
--      where is_custom or module not in ('Sales','Purchase','Sales & Purchase');
--
-- The three columns are dropped with them. workflow_source_type is untouched
-- throughout, so no Load button anywhere changes on the way back.

drop function if exists workflow_step_add(text, text, text, text, integer);
drop function if exists workflow_step_delete(text);
drop function if exists workflow_step_save(text, text, boolean, text, text, integer);

delete from workflow_steps
 where is_custom
    or doc_type not in ('sales_quotation','sale_order','sales_invoice','delivery_note',
                        'purchase_order','mrn','purchase_voucher');

alter table workflow_steps drop column if exists module;
alter table workflow_steps drop column if exists alt_source_type;
alter table workflow_steps drop column if exists is_custom;

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

revoke all on function workflow_steps_list()                   from public, anon;
revoke all on function workflow_step_save(text, text, boolean) from public, anon;
revoke all on function workflow_summary()                      from public, anon;
grant execute on function workflow_steps_list()                   to authenticated;
grant execute on function workflow_step_save(text, text, boolean) to authenticated;
grant execute on function workflow_summary()                      to authenticated;
