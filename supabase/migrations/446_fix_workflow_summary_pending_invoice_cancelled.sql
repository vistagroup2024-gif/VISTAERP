-- Same bug family as 445 (dashboard_metrics()/report_sale_orders()'s Sale
-- Order "consumed" check): workflow_summary()'s own pending_invoice figure
-- (feeds WorkFlowBoard.tsx) already correctly narrowed its trade_documents
-- check to doc_type = 'sales_invoice' — so a Purchase Order never wrongly
-- marked it invoiced — but its car_contracts check had no status filter at
-- all. A Sale Order whose only car contract was cancelled read as already
-- invoiced (dropped out of pending_invoice) on the Workflow Board, even
-- though the sale never actually happened. cc.status <> 'cancelled' is the
-- same condition 445 added, so the two "has this Sale Order been invoiced"
-- checks in the schema agree again.
create or replace function public.workflow_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- next_type is always the LOWEST-sort doc_type sourced from s.doc_type,
    -- which for sale_order is sales_invoice (sort 30, ahead of
    -- purchase_order's 50) — this field never considers car_contracts, so
    -- a car-flow Sale Order fulfilled only by a Car Invoice would read
    -- pending here regardless. Left as is: WorkFlowBoard.tsx only reads
    -- this field when pending_po/pending_invoice are both null, and for
    -- sale_order they never are (both steps are enabled), so this value is
    -- inert for sale_order today. Not restructured, to avoid touching the
    -- generic single-next_type mechanism every OTHER doc_type in the board
    -- also depends on for a value nothing currently reads.
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
                        where c.company_id = d.company_id and c.source_doc_id = d.id and c.status <> 'cancelled')) end
    ) order by s.module, s.sort), '[]'::jsonb)
  from steps s join nxt n on n.doc_type = s.doc_type;
$function$;
