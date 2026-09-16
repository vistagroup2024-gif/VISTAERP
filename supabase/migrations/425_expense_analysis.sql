-- report_expense_analysis: the same "type = 'expense'" definition
-- report_expense_budget() already uses (COGS-tagged expense accounts
-- included, matching what "Expense Budget" has always meant here — not the
-- COGS-excluded P&L convention, so this section's Total Expenses always
-- matches the budget table right below it on the same screen), broken down
-- by month, cost centre and account group (subtype).
create or replace function public.report_expense_analysis(p_company uuid, p_from date, p_to date)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
with gl as (
  select l.account_id, ac.code, ac.name, coalesce(ac.subtype, 'Other') as subtype,
    coalesce(l.cost_center, 'Unassigned') as cost_center, e.entry_date, l.debit, l.credit
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts ac on ac.id = l.account_id
  where e.company_id = p_company and e.status = 'posted' and ac.type = 'expense' and ac.is_postable
    and e.entry_date between coalesce(p_from, '0001-01-01') and coalesce(p_to, '9999-12-31')
),
by_month as (
  select to_char(entry_date, 'YYYY-MM') as month, sum(debit - credit) as amount from gl group by 1
),
by_cc as (
  select cost_center as name, sum(debit - credit) as amount from gl group by 1
),
by_group as (
  select subtype as name, sum(debit - credit) as amount from gl group by 1
),
by_account as (
  select account_id, code, name, sum(debit - credit) as amount from gl group by 1, 2, 3
)
select jsonb_build_object(
  'total', (select coalesce(sum(debit - credit), 0) from gl),
  'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'amount', amount) order by month) from by_month), '[]'::jsonb),
  'by_cost_centre', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'amount', amount) order by amount desc) from by_cc), '[]'::jsonb),
  'by_account_group', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'amount', amount) order by amount desc) from by_group), '[]'::jsonb),
  'by_account', coalesce((select jsonb_agg(jsonb_build_object('account_id', account_id, 'code', code, 'name', name, 'amount', amount) order by amount desc) from by_account), '[]'::jsonb)
);
$function$;

revoke all on function public.report_expense_analysis(uuid, date, date) from public, anon;
grant execute on function public.report_expense_analysis(uuid, date, date) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_year int := extract(year from current_date)::int;
  v_analysis jsonb;
  v_budget jsonb;
  v_analysis_total numeric;
  v_budget_actual_sum numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_expense_analysis(v_company, make_date(v_year,1,1), (make_date(v_year,12,31))) into v_analysis;
  v_analysis_total := (v_analysis->>'total')::numeric;

  select public.report_expense_budget(v_year) into v_budget;
  select coalesce(sum((r->>'actual')::numeric),0) into v_budget_actual_sum from jsonb_array_elements(v_budget) r;

  if abs(v_analysis_total - v_budget_actual_sum) > 0.01 then
    raise exception 'report_expense_analysis self-check: total % does not match report_expense_budget actual sum %', v_analysis_total, v_budget_actual_sum;
  end if;

  raise notice 'self-check passed: analysis_total=%, budget_actual_sum=%', v_analysis_total, v_budget_actual_sum;
end;
$chk$;
