-- ============================================================================
-- 1. Real, independent cost-centre x month targets. The owner confirmed the
--    old flat acct_cost_centers.sales_target could never be right: "every
--    cost center has different targets also every month has different
--    targets, some months target can be zero some months target will be
--    high some low, so target are costcenter wise and monthwise." All 16
--    cost centres' existing sales_target are 0 today (confirmed live), so no
--    history is lost switching the reports over — a month with nothing
--    entered here reads as 0, never prorated from the old single figure,
--    which would be inventing a number the business never actually held.
--    The old flat field stays on the record (Cost Centers master's "extra"
--    editor) but no report reads it from here on.
-- ============================================================================
create table if not exists public.acct_cost_center_monthly_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  cost_center_id uuid not null references public.acct_cost_centers(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  target numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, cost_center_id, year, month)
);

alter table public.acct_cost_center_monthly_targets enable row level security;

-- Same shape as acct_cost_centers_staff (a restricted user only touches the
-- cost centres their own staff_scopes cover) — a target is master data about
-- a cost centre, so it is restricted the same way the cost centre itself is.
create policy acct_cc_monthly_targets_staff on public.acct_cost_center_monthly_targets
  for all
  using (
    company_id = auth_company_id() and is_staff()
    and (staff_scope_ids('cost_center') is null or cost_center_id = any (staff_scope_ids('cost_center')::uuid[]))
  )
  with check (
    company_id = auth_company_id() and is_staff()
    and (staff_scope_ids('cost_center') is null or cost_center_id = any (staff_scope_ids('cost_center')::uuid[]))
  );

-- ============================================================================
-- 2. report_cost_center_targets() and report_cost_centre_costing() both read
--    a per-cost-centre "target" for a period — they must agree, or this is
--    the exact two-screens-disagree trap CLAUDE.md keeps flagging. Both now
--    sum acct_cost_center_monthly_targets over whichever calendar months
--    fall inside [p_from, p_to], instead of reading the flat column.
-- ============================================================================
create or replace function public.report_cost_center_targets(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'cost_center', cc.name, 'cost_center_group', coalesce(pg.name, cc.name),
    'target', coalesce(t.target, 0), 'actual', coalesce(a.actual, 0),
    'variance', coalesce(a.actual, 0) - coalesce(t.target, 0)) order by cc.name), '[]'::jsonb)
  from acct_cost_centers cc
  left join acct_cost_centers pg on pg.id = cc.parent_id
  left join (
    select l.cost_center, sum(l.credit - l.debit) actual
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts ac on ac.id = l.account_id
    where e.company_id = auth_company_id() and e.status = 'posted' and ac.type = 'income'
      and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
    group by l.cost_center) a on a.cost_center = cc.name
  left join (
    select cost_center_id, sum(target) as target
    from acct_cost_center_monthly_targets
    where company_id = auth_company_id()
      and make_date(year, month, 1) between coalesce(date_trunc('month', p_from)::date, '0001-01-01') and coalesce(date_trunc('month', p_to)::date, '9999-12-01')
    group by cost_center_id) t on t.cost_center_id = cc.id
  where cc.company_id = auth_company_id() and cc.is_group = false;
$function$;

revoke all on function public.report_cost_center_targets(date, date) from public, anon;
grant execute on function public.report_cost_center_targets(date, date) to authenticated;

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
by_cc_month as (
  select cost_center, to_char(entry_date, 'YYYY-MM') as month,
    sum(credit - debit) filter (where acct_type = 'income') as sales,
    sum(debit - credit) filter (where acct_type = 'expense' and subtype = 'COGS') as cogs,
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS') as expense
  from gl group by 1, 2
),
cc_target as (
  select cost_center_id, sum(target) as target
  from acct_cost_center_monthly_targets
  where company_id = auth_company_id()
    and make_date(year, month, 1) between coalesce(date_trunc('month', p_from)::date, '0001-01-01') and coalesce(date_trunc('month', p_to)::date, '9999-12-01')
  group by cost_center_id
)
select coalesce(jsonb_agg(jsonb_build_object(
    'cost_centre', cc.name,
    'cost_center_group', coalesce(pg.name, cc.name),
    'target', coalesce(ct.target, 0),
    'sales', coalesce(b.sales, 0), 'variance', coalesce(b.sales, 0) - coalesce(ct.target, 0),
    'achievement', case when coalesce(ct.target, 0) > 0 then round(coalesce(b.sales, 0) / ct.target * 100, 1) else null end,
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
left join cc_target ct on ct.cost_center_id = cc.id
where cc.company_id = auth_company_id() and cc.is_group = false;
$function$;

revoke all on function public.report_cost_centre_costing(date, date) from public, anon;
grant execute on function public.report_cost_centre_costing(date, date) to authenticated;

-- ============================================================================
-- 3. report_sales(): "what does txns means it should be qty" — the Qty
--    toggle on the Cost Centre / CC Group / Customer dimensions of the
--    Monthwise pivot was showing a transaction COUNT, not real item
--    quantity. doc_qty is exactly by_product_raw's own per-document
--    quantity (sum of trade_document_lines.quantity, or 1 per car contract)
--    kept at doc grain instead of collapsed by item name, so it can be
--    joined onto by_cc / by_cc_month / by_customer / by_customer_month —
--    the same source rows, a different cut, not a second calculation.
--    txns is kept alongside qty (still meaningful as a transaction count),
--    the Qty toggle just needs to read the new field instead.
--
--    by_cc_month_target is the target twin of by_cc_month (sales), so the
--    "Sales vs Target of Completed Months" table can sum sales and target
--    over the same set of cost-centre-months without a second RPC call.
-- ============================================================================
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
doc_qty as (
  select sd.doc_id, coalesce(sum(l.quantity), 0) as qty
  from sales_docs sd
  join trade_document_lines l on l.doc_id = sd.doc_id and sd.is_trade
  group by sd.doc_id
  union all
  select sd.doc_id, 1 as qty
  from sales_docs sd
  where not sd.is_trade
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
  select coalesce(sd.cost_center, 'Unassigned') as name, sum(sd.total) as amount, count(*) as txns, coalesce(sum(dq.qty), 0) as qty
  from sales_docs sd left join doc_qty dq on dq.doc_id = sd.doc_id
  group by 1
),
by_cc_month as (
  select coalesce(sd.cost_center, 'Unassigned') as name, to_char(sd.sdate, 'YYYY-MM') as month, sum(sd.total) as amount, count(*) as txns, coalesce(sum(dq.qty), 0) as qty
  from sales_docs sd left join doc_qty dq on dq.doc_id = sd.doc_id
  group by 1, 2
),
by_cc_month_target as (
  select cc.name as cost_center, coalesce(pg.name, cc.name) as cost_center_group,
    t.year || '-' || lpad(t.month::text, 2, '0') as month, t.target
  from acct_cost_center_monthly_targets t
  join acct_cost_centers cc on cc.id = t.cost_center_id
  left join acct_cost_centers pg on pg.id = cc.parent_id
  where t.company_id = p_company
    and make_date(t.year, t.month, 1) between coalesce(date_trunc('month', p_from)::date, '0001-01-01') and coalesce(date_trunc('month', p_to)::date, '9999-12-01')
),
by_customer as (
  select coalesce(p.name, 'Unspecified') as name, acc.id as account_id, sum(sd.total) as amount, count(*) as txns, coalesce(sum(dq.qty), 0) as qty
  from sales_docs sd left join parties p on p.id = sd.customer_id
  left join accounts acc on acc.party_id = p.id
  left join doc_qty dq on dq.doc_id = sd.doc_id
  group by 1, 2
),
by_customer_month as (
  select coalesce(p.name, 'Unspecified') as name, acc.id as account_id, to_char(sd.sdate, 'YYYY-MM') as month,
    sum(sd.total) as amount, count(*) as txns, coalesce(sum(dq.qty), 0) as qty
  from sales_docs sd left join parties p on p.id = sd.customer_id
  left join accounts acc on acc.party_id = p.id
  left join doc_qty dq on dq.doc_id = sd.doc_id
  group by 1, 2, 3
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
),
by_product_month_raw as (
  select coalesce(l.item_name, ap.name, 'Item') as name, to_char(sd.sdate, 'YYYY-MM') as month,
    sum(l.quantity) as qty, sum(l.amount) as amount
  from sales_docs sd
  join trade_document_lines l on l.doc_id = sd.doc_id and sd.is_trade
  left join acct_products ap on ap.id = l.product_id
  group by 1, 2
  union all
  select coalesce(ap.name, nullif(trim(concat_ws(' ', v.model_year::text, v.make, v.model, v.variant)), ''), 'Car Sale') as name,
    to_char(sd.sdate, 'YYYY-MM') as month, 1 as qty, sd.total as amount
  from sales_docs sd
  join car_contracts c on c.id = sd.doc_id and not sd.is_trade
  left join car_vehicles v on v.id = c.vehicle_id
  left join acct_products ap on ap.id = v.product_id
),
by_product_month as (
  select name, month, sum(qty) as qty, sum(amount) as amount from by_product_month_raw group by 1, 2
)
select jsonb_build_object(
  'total', (select coalesce(sum(total), 0) from sales_docs),
  'txns', (select count(*) from sales_docs),
  'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount, 'txns', txns) order by month), '[]'::jsonb) from by_month),
  'by_cost_centre', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', by_cc.name, 'cost_center_group', coalesce(cg.group_name, 'Unassigned'),
      'amount', by_cc.amount, 'txns', by_cc.txns, 'qty', by_cc.qty) order by by_cc.amount desc), '[]'::jsonb)
    from by_cc left join cc_groups cg on cg.name = by_cc.name),
  'by_cc_month', (select coalesce(jsonb_agg(jsonb_build_object(
      'cost_center', by_cc_month.name, 'cost_center_group', coalesce(cg.group_name, 'Unassigned'),
      'month', by_cc_month.month, 'amount', by_cc_month.amount, 'txns', by_cc_month.txns, 'qty', by_cc_month.qty) order by by_cc_month.name, by_cc_month.month), '[]'::jsonb)
    from by_cc_month left join cc_groups cg on cg.name = by_cc_month.name),
  'by_cc_month_target', (select coalesce(jsonb_agg(jsonb_build_object(
      'cost_center', cost_center, 'cost_center_group', cost_center_group, 'month', month, 'target', target) order by cost_center, month), '[]'::jsonb)
    from by_cc_month_target),
  'by_customer', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'account_id', account_id, 'amount', amount, 'txns', txns, 'qty', qty) order by amount desc), '[]'::jsonb) from by_customer),
  'by_customer_month', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'account_id', account_id, 'month', month, 'amount', amount, 'txns', txns, 'qty', qty) order by name, month), '[]'::jsonb) from by_customer_month),
  'by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'amount', amount) order by amount desc), '[]'::jsonb) from by_product),
  'by_product_month', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'month', month, 'qty', qty, 'amount', amount) order by name, month), '[]'::jsonb) from by_product_month)
);
$function$;

revoke all on function public.report_sales(uuid, date, date) from public, anon;
grant execute on function public.report_sales(uuid, date, date) to authenticated;
