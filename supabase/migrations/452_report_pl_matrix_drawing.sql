-- Drawing lines already carry a real cost_center/tag_area, typed by the
-- user the same as any other voucher line (a Payment against a Drawing
-- account with Cost Centre "MAIN" is ordinary data entry, not a special
-- case) — report_drawings() and report_pl_matrix() simply never read it.
-- Adds 'drawing' (sum of debit-credit for subtype='Drawing' equity lines)
-- to the same (cost_center, tag_area, month) grouping the other three
-- figures already use, so P&L's Filteration table can show a real,
-- attributed Drawing column at every level instead of only the flat
-- whole-company view. Deliberately NOT folded into sales/cogs/expense —
-- an owner's drawing is not a business expense, so Gross/Net Profit stay
-- exactly as they were; only the separate Drawing/Actual Net/Act% columns
-- read it.
create or replace function public.report_pl_matrix(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with gl as (
  select coalesce(l.cost_center, 'Unassigned') as cost_center, coalesce(l.tag_area, 'Unassigned') as tag_area,
    a.type as acct_type, a.subtype, l.debit, l.credit, e.entry_date
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  where e.company_id = auth_company_id() and e.status = 'posted'
    and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
),
cc_lookup as (
  select cc.id, cc.name, coalesce(pg.name, cc.name) as grp
  from acct_cost_centers cc left join acct_cost_centers pg on pg.id = cc.parent_id
  where cc.company_id = auth_company_id() and cc.is_group = false
),
ta_lookup as (
  select ta.id, ta.name, coalesce(pg.name, ta.name) as grp
  from acct_tag_areas ta left join acct_tag_areas pg on pg.id = ta.parent_id
  where ta.company_id = auth_company_id() and ta.is_group = false
),
agg as (
  select cost_center, tag_area, to_char(entry_date, 'YYYY-MM') as month,
    sum(credit - debit) filter (where acct_type = 'income') as sales,
    sum(debit - credit) filter (where acct_type = 'expense' and subtype = 'COGS') as cogs,
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS') as expense,
    sum(debit - credit) filter (where acct_type = 'equity' and subtype = 'Drawing') as drawing
  from gl group by 1, 2, 3
)
select coalesce(jsonb_agg(jsonb_build_object(
    'cost_center_id', cc.id, 'cost_center', coalesce(cc.name, x.cost_center), 'cost_center_group', coalesce(cc.grp, x.cost_center),
    'tag_area_id', ta.id, 'tag_area', coalesce(ta.name, x.tag_area), 'tag_area_group', coalesce(ta.grp, x.tag_area),
    'month', x.month, 'sales', coalesce(x.sales, 0), 'cogs', coalesce(x.cogs, 0), 'expense', coalesce(x.expense, 0),
    'drawing', coalesce(x.drawing, 0)
  )), '[]'::jsonb)
from agg x
left join cc_lookup cc on cc.name = x.cost_center
left join ta_lookup ta on ta.name = x.tag_area;
$function$;
