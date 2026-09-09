-- The Car Invoice is raised at the price on the Sale Order's LINE.
--
-- A car Sale Order shows its grid again, and that line is the car being sold at
-- the price it is being sold for. The price can be adjusted there — the costing
-- block above works out a Selling Price, but what is finally agreed at the point
-- of ordering is typed on the line, and that is the figure the customer's order
-- says. So that is the figure the invoice has to be raised at.
--
-- `car_invoice_from_sale_order` read `meta->>'selling_price'` — the costing
-- block's answer, not the order's. While the grid was hidden the two were always
-- the same number, because the line was BUILT from selling_price at save; with
-- the grid back they can differ, and the line is the one that means something.
--
-- The order of preference is the order of authority:
--   the line total   what the order says the car is being sold for
--   selling_price    the costing block, for orders raised while the grid was hidden
--   d.total          last resort
-- The first two agree on every order raised so far, so nothing already in the
-- system moves; this only changes what happens when they stop agreeing.
--
-- sum() rather than the first line: a car order is one line and the UI now keeps
-- it that way, but summing is right for whatever is actually there rather than
-- silently invoicing part of it.

create or replace function public.car_invoice_from_sale_order(p_doc uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
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
$fn$;
