-- P&L Filteration's "Tag Area" mode needs the same Group -> leaf -> Month P&L
-- shape report_cost_centre_costing() already returns for cost centres, but
-- keyed on acct_tag_areas / journal_lines.tag_area instead. Tag areas carry
-- no sales_target column, so there is no target/variance/achievement here —
-- everything else mirrors report_cost_centre_costing() exactly.
create or replace function public.report_tag_area_costing(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with gl as (
  select l.tag_area, a.type as acct_type, a.subtype, l.debit, l.credit, e.entry_date
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  where e.company_id = auth_company_id() and e.status = 'posted'
    and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
),
by_ta as (
  select tag_area,
    sum(credit - debit) filter (where acct_type = 'income') as sales,
    sum(debit - credit) filter (where acct_type = 'expense' and subtype = 'COGS') as cogs,
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS') as expense
  from gl group by tag_area
),
by_ta_month as (
  select tag_area, to_char(entry_date, 'YYYY-MM') as month,
    sum(credit - debit) filter (where acct_type = 'income') as sales,
    sum(debit - credit) filter (where acct_type = 'expense' and subtype = 'COGS') as cogs,
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS') as expense
  from gl group by 1, 2
)
select coalesce(jsonb_agg(jsonb_build_object(
    'tag_area', ta.name,
    'tag_area_group', coalesce(pg.name, ta.name),
    'sales', coalesce(b.sales, 0),
    'cogs', coalesce(b.cogs, 0),
    'gross_profit', coalesce(b.sales, 0) - coalesce(b.cogs, 0),
    'gp_pct', case when coalesce(b.sales, 0) <> 0 then round((coalesce(b.sales, 0) - coalesce(b.cogs, 0)) / b.sales * 100, 1) else null end,
    'expense', coalesce(b.expense, 0),
    'net_profit', coalesce(b.sales, 0) - coalesce(b.cogs, 0) - coalesce(b.expense, 0),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object(
        'month', m.month, 'sales', m.sales, 'cogs', m.cogs,
        'gross_profit', m.sales - m.cogs, 'expense', m.expense,
        'net_profit', m.sales - m.cogs - m.expense) order by m.month), '[]'::jsonb)
      from by_ta_month m where m.tag_area = ta.name)
  ) order by ta.name), '[]'::jsonb)
from acct_tag_areas ta
left join acct_tag_areas pg on pg.id = ta.parent_id
left join by_ta b on b.tag_area = ta.name
where ta.company_id = auth_company_id() and ta.is_group = false;
$function$;

revoke all on function public.report_tag_area_costing(date, date) from public, anon;
grant execute on function public.report_tag_area_costing(date, date) to authenticated;
