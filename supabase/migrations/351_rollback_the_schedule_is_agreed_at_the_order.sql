-- Undo 351. The Car Invoice stops receiving the order's schedule and goes back
-- to starting empty, with Generate. Schedules already stored on Sale Orders are
-- left in their meta, harmless and ignored.

begin;

create or replace function public.car_invoice_from_sale_order(p_doc uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select case when d.id is null then null else jsonb_build_object(
    'id', d.id, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
    'customer_id', d.party_id,
    'cost_center', d.cost_center, 'tag_area', d.tag_area,
    'reference_name', d.reference, 'notes', d.narration,
    'sale_price', coalesce(
      (select nullif(sum(l.amount), 0) from trade_document_lines l where l.doc_id = d.id),
      nullif(d.meta->>'selling_price','')::numeric, d.total),
    'advance', coalesce(nullif(d.meta->>'advance','')::numeric, 0),
    'advance_due_date', nullif(d.meta->>'advance_due_date',''),
    'installment_months', coalesce(nullif(d.meta->>'installment_months','')::int, 0),
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

commit;
