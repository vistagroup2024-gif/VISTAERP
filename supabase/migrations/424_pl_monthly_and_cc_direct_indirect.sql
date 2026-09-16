-- Phase 3: P&L gets a monthly trend (new report_pl_monthly, same
-- income/COGS/expense classification trial_balance's own consumer — the P&L
-- page's summarize() — already uses, just grouped by month in one query
-- instead of N calls to trial_balance). CC Costing gets Direct Expense /
-- Indirect Expense as a further breakdown of the existing `expense` total
-- (accounts.subtype already offers 'Direct Expense'/'Indirect Expense' as
-- values — this is reading an existing classification, not inventing one);
-- `expense` itself is unchanged, so net_profit's existing calculation and
-- every existing self-check on it still holds.
create or replace function public.report_pl_monthly(p_company uuid, p_from date, p_to date)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
with gl as (
  select to_char(e.entry_date, 'YYYY-MM') as month, a.type as nature, a.subtype, l.debit, l.credit
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  where e.company_id = p_company and e.status = 'posted'
    and e.entry_date between coalesce(p_from,'0001-01-01') and coalesce(p_to,'9999-12-31')
),
by_month as (
  select month,
    sum(credit - debit) filter (where nature = 'income') as revenue,
    sum(debit - credit) filter (where nature = 'expense' and subtype = 'COGS') as cogs,
    sum(debit - credit) filter (where nature = 'expense' and coalesce(subtype,'') <> 'COGS') as expense
  from gl group by 1
)
select coalesce(jsonb_agg(jsonb_build_object(
  'month', month, 'revenue', coalesce(revenue,0), 'cogs', coalesce(cogs,0),
  'gross_profit', coalesce(revenue,0) - coalesce(cogs,0), 'expense', coalesce(expense,0),
  'net_profit', coalesce(revenue,0) - coalesce(cogs,0) - coalesce(expense,0)
) order by month), '[]'::jsonb)
from by_month;
$function$;

revoke all on function public.report_pl_monthly(uuid, date, date) from public, anon;
grant execute on function public.report_pl_monthly(uuid, date, date) to authenticated;

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
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS') as expense,
    sum(debit - credit) filter (where acct_type = 'expense' and subtype = 'Direct Expense') as direct_expense,
    sum(debit - credit) filter (where acct_type = 'expense' and coalesce(subtype, '') not in ('COGS', 'Direct Expense')) as indirect_expense
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
    'direct_expense', coalesce(b.direct_expense, 0),
    'indirect_expense', coalesce(b.indirect_expense, 0),
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
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_monthly jsonb;
  v_monthly_net numeric;
  v_direct_net numeric;
  v_cc jsonb;
  v_cc_expense_sum numeric; v_cc_split_sum numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_pl_monthly(v_company, '2000-01-01', current_date) into v_monthly;
  select coalesce(sum((r->>'net_profit')::numeric),0) into v_monthly_net from jsonb_array_elements(v_monthly) r;

  select coalesce(sum(credit - debit) filter (where a.type='income'),0)
       - coalesce(sum(debit - credit) filter (where a.type='expense' and a.subtype='COGS'),0)
       - coalesce(sum(debit - credit) filter (where a.type='expense' and coalesce(a.subtype,'')<>'COGS'),0)
    into v_direct_net
  from journal_lines l join journal_entries e on e.id=l.entry_id join accounts a on a.id=l.account_id
  where e.company_id = v_company and e.status='posted';

  if abs(v_monthly_net - v_direct_net) > 0.01 then
    raise exception 'report_pl_monthly self-check: monthly net sum % does not match direct GL net %', v_monthly_net, v_direct_net;
  end if;

  select public.report_cost_centre_costing('2000-01-01', current_date) into v_cc;
  select coalesce(sum((r->>'expense')::numeric),0) into v_cc_expense_sum from jsonb_array_elements(v_cc) r;
  select coalesce(sum((r->>'direct_expense')::numeric),0) + coalesce(sum((r->>'indirect_expense')::numeric),0) into v_cc_split_sum from jsonb_array_elements(v_cc) r;
  if abs(v_cc_expense_sum - v_cc_split_sum) > 0.01 then
    raise exception 'report_cost_centre_costing self-check: expense % does not equal direct+indirect %', v_cc_expense_sum, v_cc_split_sum;
  end if;

  raise notice 'phase 3 self-check passed: monthly_net=%, cc_expense=%, cc_split=%', v_monthly_net, v_cc_expense_sum, v_cc_split_sum;
end;
$chk$;
