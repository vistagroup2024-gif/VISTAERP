-- The instalment schedule is agreed on the Sale Order and carried to the invoice.
--
-- A car deal's schedule — when each payment falls due and for how much — was
-- only ever typed on the Car Invoice, weeks after the customer agreed to it.
-- The order carried the months and the monthly figure, so the operator pressed
-- Generate and got a schedule of round numbers on dates nobody had discussed.
-- Whatever was actually negotiated lived on paper.
--
-- The Sale Order now holds the schedule (in its meta, alongside the rest of the
-- costing block), and car_invoice_from_sale_order hands it over with everything
-- else. Generate is still on the invoice for an order that carries none.
--
-- WHY IT IS SHOWN AND NOT REFUSED ON THE ORDER. The Car Invoice enforces
-- advance + instalments = net payable. An order whose schedule does not reach
-- that is one that cannot be invoiced without being retyped — so the order says
-- so, in the difference line under the table, while it can still be fixed. It
-- does not refuse: an order is still being negotiated, and a schedule that is
-- half-entered is a normal state for it to be in.

begin;

create or replace function public.car_invoice_from_sale_order(p_doc uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select case when d.id is null then null else jsonb_build_object(
    'id', d.id, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
    'customer_id', d.party_id,
    'cost_center', d.cost_center, 'tag_area', d.tag_area,
    'reference_name', d.reference, 'notes', d.narration,
    'sale_price', coalesce(
      (select nullif(sum(l.amount), 0) from trade_document_lines l where l.doc_id = d.id),
      nullif(d.meta->>'selling_price','')::numeric,
      d.total),
    'advance', coalesce(nullif(d.meta->>'advance','')::numeric, 0),
    'advance_due_date', nullif(d.meta->>'advance_due_date',''),
    'installment_months', coalesce(nullif(d.meta->>'installment_months','')::int, 0),
    'installments', coalesce(d.meta->'installments', '[]'::jsonb),
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

do $chk$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='car_invoice_from_sale_order') not like '%installments%'
  then raise exception '351: the schedule is not carried across'; end if;
end $chk$;

commit;
