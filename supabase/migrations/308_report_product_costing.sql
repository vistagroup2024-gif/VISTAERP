-- Sales costing by product, beside the by-document view it already had.
--
-- security invoker on purpose: RLS on acct_products then filters it to the
-- items a restricted user may see, and the report has nothing to remember.

create or replace function report_product_costing(p_from date default null, p_to date default null)
returns jsonb language sql stable set search_path to 'public' as $function$
  with docs as (
    select d.id, d.doc_no, d.doc_type
    from trade_documents d
    where d.doc_type in ('sales_invoice', 'sales_return')
      and d.gl_entry is not null
      and (p_from is null or d.doc_date >= p_from)
      and (p_to  is null or d.doc_date <= p_to)
  ),
  sold as (
    select l.product_id,
           sum(case when d.doc_type = 'sales_invoice' then  coalesce(l.quantity,0)
                                                      else -coalesce(l.quantity,0) end) as qty,
           sum(case when d.doc_type = 'sales_invoice' then  coalesce(l.amount,0)
                                                      else -coalesce(l.amount,0) end)   as revenue,
           count(distinct d.id) filter (where d.doc_type = 'sales_invoice')              as invoices
    from docs d join trade_document_lines l on l.doc_id = d.id
    where l.product_id is not null
    group by l.product_id
  ),
  -- What those same documents took out of stock. An issue is cost; the receipt
  -- a sales return puts back is cost coming off again.
  moved as (
    select m.item_id as product_id,
           sum(case when m.doc_type = 'issue' then coalesce(m.value,0)
                    when m.doc_type = 'receipt' then -coalesce(m.value,0)
                    else 0 end) as cost
    from stock_movements m
    where m.reference in (select doc_no from docs)
    group by m.item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', s.product_id,
    'item', p.name,
    'uom', p.uom,
    'qty', round(s.qty, 3),
    'invoices', s.invoices,
    'revenue', round(s.revenue, 2),
    'cost', round(c.cost, 2),
    'cost_basis', c.basis,
    'profit', round(s.revenue - c.cost, 2),
    'margin', case when s.revenue <> 0
                   then round((s.revenue - c.cost) / s.revenue * 100, 1) else 0 end
  ) order by (s.revenue - c.cost) desc), '[]'::jsonb)
  from sold s
  join acct_products p on p.id = s.product_id
  cross join lateral (
    -- A product that moved through stock is costed at what stock says it cost;
    -- one that never did falls back to its purchase rate, and says so.
    select case when m.cost is not null then m.cost
                else round(s.qty * coalesce(p.purchase_rate, 0), 2) end as cost,
           case when m.cost is not null then 'stock' else 'rate' end    as basis
    from (select 1) _ left join moved m on m.product_id = s.product_id
  ) c;
$function$;

revoke all on function report_product_costing(date, date) from public, anon;
grant execute on function report_product_costing(date, date) to authenticated;
