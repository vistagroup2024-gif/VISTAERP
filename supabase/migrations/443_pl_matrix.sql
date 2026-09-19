-- P&L Filteration's CC Group/Cost Center picked one row hierarchy (Group ->
-- leaf) and Tag Area was the one exclusive alternate SOURCE to it, since
-- report_cost_centre_costing() and report_tag_area_costing() were two
-- separate RPCs a user could only read from one of. But a journal line
-- carries BOTH cost_center and tag_area on the same row, the same shape
-- Expense Report's cost-centre/account combination turned out to have
-- (441/442) — so Tag Area combining WITH Cost Centre ("this cost centre's
-- own tag areas") is a real, answerable question, not a mismatched
-- comparison. report_pl_matrix() is the P&L equivalent of
-- report_expense_matrix(): one row per (cost centre, tag area, month),
-- carrying both dimensions' ids/names/groups plus sales/cogs/expense, so
-- the client can nest CC Group / Cost Center / Tag Area Group / Tag Area
-- in whichever combination and order is clicked, the same click-order
-- system Expense Report already uses. report_cost_centre_costing() is
-- untouched (the Cost Center Profit & Loss side panel, and its own
-- target/variance columns, still read it directly) and
-- report_tag_area_costing() is left in the schema unused by this screen,
-- the same "superseded but not dropped" choice 441 made for
-- report_expense_by_account().
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
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS') as expense
  from gl group by 1, 2, 3
)
select coalesce(jsonb_agg(jsonb_build_object(
    'cost_center_id', cc.id, 'cost_center', coalesce(cc.name, x.cost_center), 'cost_center_group', coalesce(cc.grp, x.cost_center),
    'tag_area_id', ta.id, 'tag_area', coalesce(ta.name, x.tag_area), 'tag_area_group', coalesce(ta.grp, x.tag_area),
    'month', x.month, 'sales', coalesce(x.sales, 0), 'cogs', coalesce(x.cogs, 0), 'expense', coalesce(x.expense, 0)
  )), '[]'::jsonb)
from agg x
left join cc_lookup cc on cc.name = x.cost_center
left join ta_lookup ta on ta.name = x.tag_area;
$function$;

revoke all on function public.report_pl_matrix(date, date) from public, anon;
grant execute on function public.report_pl_matrix(date, date) to authenticated;

do $chk$
declare
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_year    int  := extract(year from current_date)::int;
  v_result  jsonb;
  v_sales numeric; v_cogs numeric; v_expense numeric;
  d_sales numeric; d_cogs numeric; d_expense numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_pl_matrix(make_date(v_year,1,1), make_date(v_year,12,31)) into v_result;
  select coalesce(sum((r->>'sales')::numeric),0), coalesce(sum((r->>'cogs')::numeric),0), coalesce(sum((r->>'expense')::numeric),0)
    into v_sales, v_cogs, v_expense
  from jsonb_array_elements(v_result) r;

  select coalesce(sum(credit - debit) filter (where a.type = 'income'), 0),
         coalesce(sum(debit - credit) filter (where a.type = 'expense' and a.subtype = 'COGS'), 0),
         coalesce(sum(debit - credit) filter (where a.type = 'expense' and coalesce(a.subtype,'') <> 'COGS'), 0)
    into d_sales, d_cogs, d_expense
  from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
  where e.company_id = '96f6b539-b491-4df7-91a2-80c7c8e7491d' and e.status = 'posted'
    and e.entry_date between make_date(v_year,1,1) and make_date(v_year,12,31);

  if abs(v_sales - d_sales) > 0.01 or abs(v_cogs - d_cogs) > 0.01 or abs(v_expense - d_expense) > 0.01 then
    raise exception 'report_pl_matrix self-check mismatch: sales %/%  cogs %/%  expense %/%', v_sales, d_sales, v_cogs, d_cogs, v_expense, d_expense;
  end if;

  raise notice 'self-check passed: sales=% cogs=% expense=% rows=%', v_sales, v_cogs, v_expense, jsonb_array_length(v_result);
end;
$chk$;
