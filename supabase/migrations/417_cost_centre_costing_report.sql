-- Cost Centre Costing — extends report_cost_center_targets() (already live,
-- used by Targets & Budget and Sales Report) with COGS, Gross Profit, GP%
-- and Expense per cost centre, so a Cost Centre's own mini-P&L is one call
-- instead of the target/actual figure alone. Same nature/subtype
-- conventions the P&L and dashboard_metrics() already use throughout this
-- ERP (subtype = 'COGS' is cost of sales, every other expense account is
-- overhead) — not a new accounting definition.
--
-- Break-even quantity/amount is NOT computed here: this schema carries no
-- fixed-vs-variable cost classification for any account or product, so a
-- break-even figure would have to guess at one. Rather than fabricate a
-- number with no real basis, this report stops at Gross Profit / GP% / Net
-- and leaves break-even for when that classification actually exists.
create or replace function public.report_cost_centre_costing(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with gl as (
  select l.cost_center, a.type as acct_type, a.subtype, l.debit, l.credit
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
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS') as expense
  from gl group by cost_center
)
select coalesce(jsonb_agg(jsonb_build_object(
    'cost_centre', cc.name, 'target', cc.sales_target,
    'sales', coalesce(b.sales, 0), 'variance', coalesce(b.sales, 0) - cc.sales_target,
    'achievement', case when cc.sales_target > 0 then round(coalesce(b.sales, 0) / cc.sales_target * 100, 1) else null end,
    'cogs', coalesce(b.cogs, 0),
    'gross_profit', coalesce(b.sales, 0) - coalesce(b.cogs, 0),
    'gp_pct', case when coalesce(b.sales, 0) <> 0 then round((coalesce(b.sales, 0) - coalesce(b.cogs, 0)) / b.sales * 100, 1) else null end,
    'expense', coalesce(b.expense, 0),
    'net_profit', coalesce(b.sales, 0) - coalesce(b.cogs, 0) - coalesce(b.expense, 0)
  ) order by cc.name), '[]'::jsonb)
from acct_cost_centers cc
left join by_cc b on b.cost_center = cc.name
where cc.company_id = auth_company_id() and cc.is_group = false;
$function$;

revoke all on function public.report_cost_centre_costing(date, date) from public, anon;
grant execute on function public.report_cost_centre_costing(date, date) to authenticated;

do $chk$
declare
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_result jsonb;
  v_sales_sum numeric;
  v_target_sales jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_cost_centre_costing('2000-01-01', current_date) into v_result;
  select public.report_cost_center_targets('2000-01-01', current_date) into v_target_sales;

  select coalesce(sum((r->>'sales')::numeric), 0) into v_sales_sum from jsonb_array_elements(v_result) r;

  -- Sales per cost centre must match report_cost_center_targets()'s own
  -- "actual" — same income-account definition, just carried alongside COGS
  -- and expense here instead of alone.
  if abs(v_sales_sum - (select coalesce(sum((r->>'actual')::numeric), 0) from jsonb_array_elements(v_target_sales) r)) > 0.01 then
    raise exception 'report_cost_centre_costing self-check: sales % does not match report_cost_center_targets actual %',
      v_sales_sum, (select coalesce(sum((r->>'actual')::numeric), 0) from jsonb_array_elements(v_target_sales) r);
  end if;

  raise notice 'report_cost_centre_costing self-check passed: cost_centres=%, sales=%', jsonb_array_length(v_result), v_sales_sum;
end;
$chk$;
