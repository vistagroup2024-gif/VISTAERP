-- report_pl_matrix()'s own `gl` CTE grouped EVERY posted journal line by
-- (cost_center, tag_area, month) before the `agg` CTE's filter clauses
-- picked out only income/COGS/expense/Drawing sums — so a cash, bank,
-- receivable or payable line with no cost centre (an ordinary Receipt
-- Voucher's cash leg, say) still created an 'Unassigned' (cost_center,
-- tag_area, month) bucket in the grouping surface, with every one of its
-- filtered sums correctly landing on zero. The bucket itself still made
-- it into the output: a phantom, all-zero 'Unassigned' row under CC
-- Group/Cost Center, real activity nowhere in it. Confirmed live:
-- September 2026 carried exactly one such row (sales/cogs/expense/
-- drawing all 0) that had no business being in a P&L breakdown at all.
--
-- Restricts `gl` to only lines whose account is actually one of the four
-- types this report aggregates (income, expense, or equity+Drawing) —
-- the same set the `agg` CTE's own filter clauses already read, just
-- applied before the grouping instead of only after it. Tag Area's own
-- 'Unassigned' bucket is untouched and still real: many genuine income/
-- expense lines carry no tag area at all (it's the optional dimension),
-- so that bucket keeps its real, non-zero figures — this fix removes the
-- FAKE zero-activity bucket, not the dimension's honest "nothing chosen"
-- case, which is exactly what "Unassigned only where the data is
-- genuinely absent" means for a dimension every P&L line always carries
-- (cost centre) versus one that doesn't (tag area).
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
    and (a.type = 'income' or a.type = 'expense' or (a.type = 'equity' and a.subtype = 'Drawing'))
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
