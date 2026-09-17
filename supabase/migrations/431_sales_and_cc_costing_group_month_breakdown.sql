-- Owner reporting phase: Sales Report and Cost Centre Costing need a real
-- Cost Centre Group -> Cost Centre -> Month hierarchy and a Cost Centre x
-- Month cross-tab, using the ACTUAL acct_cost_centers.parent_id relationship
-- (the same join report_cost_center_targets() already established) rather
-- than inventing one. Both changes are additive: every existing field these
-- two RPCs already returned is unchanged, and every new field is a finer
-- grouping of the exact same source rows (sales_docs / gl) the existing
-- totals already come from — not a second, independently-derived
-- calculation. Self-checked before applying: by_cc_month sums back to the
-- same top-level total report_sales already returned; each cost centre's
-- new monthly array sums back to that same cost centre's own existing
-- sales figure.
create or replace function public.report_sales(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with sales_docs as (
  select d.doc_date as sdate, d.total, d.party_id as customer_id, d.cost_center, d.id as doc_id, true as is_trade
    from trade_documents d
   where d.company_id = p_company
     and d.doc_type in ('sales_invoice','air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice')
     and d.gl_entry is not null
     and d.doc_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
  union all
  select c.contract_date, c.net_payable, c.customer_id, c.cost_center, c.id, false
    from car_contracts c
   where c.company_id = p_company and c.status in ('active', 'completed')
     and c.contract_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
),
cc_groups as (
  select cc.name, coalesce(pg.name, cc.name) as group_name
  from acct_cost_centers cc
  left join acct_cost_centers pg on pg.id = cc.parent_id
  where cc.company_id = p_company
),
by_month as (
  select to_char(sdate, 'YYYY-MM') as month, sum(total) as amount, count(*) as txns
  from sales_docs group by 1
),
by_cc as (
  select coalesce(cost_center, 'Unassigned') as name, sum(total) as amount, count(*) as txns
  from sales_docs group by 1
),
-- Cost Centre x Month cross-tab, the same sales_docs rows the flat by_cc and
-- by_month breakdowns already aggregate, grouped by both at once instead of
-- one or the other — this is what a Cost Centre x Month pivot view needs and
-- neither existing breakdown could supply on its own.
by_cc_month as (
  select coalesce(cost_center, 'Unassigned') as name, to_char(sdate, 'YYYY-MM') as month, sum(total) as amount
  from sales_docs group by 1, 2
),
by_customer as (
  select coalesce(p.name, 'Unspecified') as name, acc.id as account_id, sum(sd.total) as amount, count(*) as txns
  from sales_docs sd left join parties p on p.id = sd.customer_id
  left join accounts acc on acc.party_id = p.id
  group by 1, 2
),
by_product_raw as (
  select coalesce(l.item_name, ap.name, 'Item') as name, sum(l.quantity) as qty, sum(l.amount) as amount
  from sales_docs sd
  join trade_document_lines l on l.doc_id = sd.doc_id and sd.is_trade
  left join acct_products ap on ap.id = l.product_id
  group by 1
  union all
  select coalesce(ap.name, nullif(trim(concat_ws(' ', v.model_year::text, v.make, v.model, v.variant)), ''), 'Car Sale') as name,
    1 as qty, sd.total as amount
  from sales_docs sd
  join car_contracts c on c.id = sd.doc_id and not sd.is_trade
  left join car_vehicles v on v.id = c.vehicle_id
  left join acct_products ap on ap.id = v.product_id
),
by_product as (
  select name, sum(qty) as qty, sum(amount) as amount from by_product_raw group by 1
)
select jsonb_build_object(
  'total', (select coalesce(sum(total), 0) from sales_docs),
  'txns', (select count(*) from sales_docs),
  'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount, 'txns', txns) order by month), '[]'::jsonb) from by_month),
  'by_cost_centre', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', by_cc.name, 'cost_center_group', coalesce(cg.group_name, 'Unassigned'),
      'amount', by_cc.amount, 'txns', by_cc.txns) order by by_cc.amount desc), '[]'::jsonb)
    from by_cc left join cc_groups cg on cg.name = by_cc.name),
  'by_cc_month', (select coalesce(jsonb_agg(jsonb_build_object(
      'cost_center', by_cc_month.name, 'cost_center_group', coalesce(cg.group_name, 'Unassigned'),
      'month', by_cc_month.month, 'amount', by_cc_month.amount) order by by_cc_month.name, by_cc_month.month), '[]'::jsonb)
    from by_cc_month left join cc_groups cg on cg.name = by_cc_month.name),
  'by_customer', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'account_id', account_id, 'amount', amount, 'txns', txns) order by amount desc), '[]'::jsonb) from by_customer),
  'by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'amount', amount) order by amount desc), '[]'::jsonb) from by_product)
);
$function$;

revoke all on function public.report_sales(uuid, date, date) from public, anon;
grant execute on function public.report_sales(uuid, date, date) to authenticated;

create or replace function public.report_cost_centre_costing(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with gl as (
  select l.cost_center, a.type as acct_type, a.subtype, l.debit, l.credit, e.entry_date
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  where e.company_id = auth_company_id() and e.status = 'posted'
    and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
),
by_cc as (
  select cost_center,
    sum(credit - debit) filter (where acct_type = 'income') as sales,
    sum(debit - credit) filter (where acct_type = 'expense' and subtype = 'COGS') as cogs,
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS') as expense,
    sum(debit - credit) filter (where acct_type = 'expense' and subtype = 'Direct Expense') as direct_expense,
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') not in ('COGS', 'Direct Expense')) as indirect_expense
  from gl group by cost_center
),
-- Same gl rows as by_cc, grouped by month too — Group -> Cost Centre ->
-- Month is the hierarchy the owner asked for, and this is the one extra
-- grouping that makes the "Month" leaf of it possible without a second,
-- independently-derived calculation.
by_cc_month as (
  select cost_center, to_char(entry_date, 'YYYY-MM') as month,
    sum(credit - debit) filter (where acct_type = 'income') as sales,
    sum(debit - credit) filter (where acct_type = 'expense' and subtype = 'COGS') as cogs,
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS') as expense
  from gl group by 1, 2
)
select coalesce(jsonb_agg(jsonb_build_object(
    'cost_centre', cc.name,
    'cost_center_group', coalesce(pg.name, cc.name),
    'target', cc.sales_target,
    'sales', coalesce(b.sales, 0), 'variance', coalesce(b.sales, 0) - cc.sales_target,
    'achievement', case when cc.sales_target > 0 then round(coalesce(b.sales, 0) / cc.sales_target * 100, 1) else null end,
    'cogs', coalesce(b.cogs, 0),
    'gross_profit', coalesce(b.sales, 0) - coalesce(b.cogs, 0),
    'gp_pct', case when coalesce(b.sales, 0) <> 0 then round((coalesce(b.sales, 0) - coalesce(b.cogs, 0)) / b.sales * 100, 1) else null end,
    'expense', coalesce(b.expense, 0),
    'direct_expense', coalesce(b.direct_expense, 0),
    'indirect_expense', coalesce(b.indirect_expense, 0),
    'net_profit', coalesce(b.sales, 0) - coalesce(b.cogs, 0) - coalesce(b.expense, 0),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object(
        'month', m.month, 'sales', m.sales, 'cogs', m.cogs,
        'gross_profit', m.sales - m.cogs, 'expense', m.expense,
        'net_profit', m.sales - m.cogs - m.expense) order by m.month), '[]'::jsonb)
      from by_cc_month m where m.cost_center = cc.name)
  ) order by cc.name), '[]'::jsonb)
from acct_cost_centers cc
left join acct_cost_centers pg on pg.id = cc.parent_id
left join by_cc b on b.cost_center = cc.name
where cc.company_id = auth_company_id() and cc.is_group = false;
$function$;

revoke all on function public.report_cost_centre_costing(date, date) from public, anon;
grant execute on function public.report_cost_centre_costing(date, date) to authenticated;
