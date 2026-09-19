-- Expense Report — the old software's "Expenses Detail" dashboard, rebuilt
-- as a real report page (/accounting/expenses) on this ERP's own report
-- system rather than copied pixel-for-pixel. Three pieces:
--
-- 1. report_expense_by_account(): the ONE genuinely new data source. CC Group
--    / Cost Center and Tag Area pivots already exist — report_cost_centre_costing()
--    and report_tag_area_costing() both already carry a per-leaf `expense`
--    figure (type='expense' and subtype<>'COGS', the same definition
--    report_expense_budget()/report_expense_analysis() already use) with its
--    own monthly breakdown, so the Expense report reads those two RPCs
--    straight rather than re-deriving the same numbers a third way. Account
--    Group / Account Name has no existing source: an expense ACCOUNT'S own
--    immediate parent group (accounts.parent_id, the same single-level join
--    cost_centre_group/tag_area_group already use) has never been resolved
--    anywhere in the schema.
--
-- 2. acct_expense_budgets_cc + report_expense_budget_cc(): the old
--    software's "Monthly and Yearly Budgets" panel is a genuine gap, not a
--    presentation one — acct_expense_budgets (249) is only ever (account,
--    year), with no cost-centre split at all, so there was nowhere to read
--    a per-cost-centre budget from. Verified against the screenshot's own
--    numbers: every row's Yearly figure is exactly Monthly x 12 (Salaries -
--    Staff (Off) under Monthly Car Service Charges: 6,200 x 12 = 74,400,
--    matching exactly; checked across every filled cell in both screenshots,
--    all exact), so this is a flat RECURRING monthly amount per (account,
--    cost centre), annualised — not a 12-cell month-by-month grid the way
--    acct_cost_center_monthly_targets is for sales targets. Read/write both
--    go straight through RLS (`for all`), the same direct-upsert pattern
--    acct_cost_center_monthly_targets already uses — no wrapper RPC needed
--    for a save this simple.
--
-- The existing "Expense Budget" tab on Targets & Budget (its own
-- acct_expense_budgets, account+year only, no cost centre) is left exactly
-- as it is — a real, separate, simpler figure that predates this report,
-- not replaced or merged into it. The two will read different Budget totals
-- for the same account, and that is a known, accepted gap: retiring or
-- merging the old screen is its own follow-up, not silently done here.

create table if not exists public.acct_expense_budgets_cc (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  cost_center_id uuid not null references public.acct_cost_centers(id) on delete cascade,
  year integer not null,
  monthly_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, account_id, cost_center_id, year)
);

alter table public.acct_expense_budgets_cc enable row level security;

-- Restricted the same way acct_cost_center_monthly_targets already is, on
-- BOTH dimensions this budget touches: a user who may not see this account
-- or may not see this cost centre may not see (or write) a budget crossing
-- either.
create policy acct_expense_budgets_cc_staff on public.acct_expense_budgets_cc
  for all
  using (
    company_id = auth_company_id() and is_staff()
    and (staff_scope_ids('account') is null or account_id = any (staff_scope_ids('account')::uuid[]))
    and (staff_scope_ids('cost_center') is null or cost_center_id = any (staff_scope_ids('cost_center')::uuid[]))
  )
  with check (
    company_id = auth_company_id() and is_staff()
    and (staff_scope_ids('account') is null or account_id = any (staff_scope_ids('account')::uuid[]))
    and (staff_scope_ids('cost_center') is null or cost_center_id = any (staff_scope_ids('cost_center')::uuid[]))
  );

-- report_expense_by_account(): the Account Group -> Account Name leaf-level
-- source, same shape (name/group/expense/monthly) report_cost_centre_costing()
-- and report_tag_area_costing() already return for their own dimensions, so
-- the client can build all three with one shared helper.
create or replace function public.report_expense_by_account(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with exp as (
  select l.account_id, e.entry_date, (l.debit - l.credit) as amount
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.id = l.account_id
  where e.company_id = auth_company_id() and e.status = 'posted'
    and a.type = 'expense' and coalesce(a.subtype, '') <> 'COGS'
    and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
),
by_acct as (
  select account_id, sum(amount) as amount from exp group by account_id
),
by_acct_month as (
  select account_id, to_char(entry_date, 'YYYY-MM') as month, sum(amount) as amount
  from exp group by 1, 2
)
select coalesce(jsonb_agg(jsonb_build_object(
    'name', ac.name,
    'account_group', coalesce(pg.name, ac.name),
    'expense', coalesce(b.amount, 0),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'amount', m.amount) order by m.month), '[]'::jsonb)
                from by_acct_month m where m.account_id = ac.id)
  ) order by ac.name), '[]'::jsonb)
from accounts ac
left join accounts pg on pg.id = ac.parent_id
left join by_acct b on b.account_id = ac.id
where ac.company_id = auth_company_id() and ac.type = 'expense' and ac.is_postable
  and coalesce(b.amount, 0) <> 0;
$function$;

revoke all on function public.report_expense_by_account(date, date) from public, anon;
grant execute on function public.report_expense_by_account(date, date) to authenticated;

-- report_expense_budget_cc(): the full account x cost-centre matrix, every
-- postable expense account against every leaf cost centre (not only pairs
-- with a budget already entered) — an editable grid has to offer every cell
-- to fill in, the same reason acct_cost_center_monthly_targets's own grid
-- always lists every cost centre.
create or replace function public.report_expense_budget_cc(p_year int)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', ac.id, 'account_name', ac.name, 'account_group', coalesce(apg.name, ac.name),
      'cost_center_id', cc.id, 'cost_center', cc.name,
      'monthly_amount', coalesce(b.monthly_amount, 0)
    ) order by ac.name, cc.name), '[]'::jsonb)
  from accounts ac
  left join accounts apg on apg.id = ac.parent_id
  cross join acct_cost_centers cc
  left join acct_expense_budgets_cc b
    on b.account_id = ac.id and b.cost_center_id = cc.id and b.year = p_year and b.company_id = auth_company_id()
  where ac.company_id = auth_company_id() and ac.type = 'expense' and ac.is_postable
    and cc.company_id = auth_company_id() and cc.is_group = false
    and (staff_scope_ids('account') is null or ac.id = any (staff_scope_ids('account')::uuid[]))
    and (staff_scope_ids('cost_center') is null or cc.id = any (staff_scope_ids('cost_center')::uuid[]));
$function$;

revoke all on function public.report_expense_budget_cc(int) from public, anon;
grant execute on function public.report_expense_budget_cc(int) to authenticated;

-- report_expense_by_account() excludes COGS-subtype expense accounts, the
-- SAME "expense" definition dashboard_metrics()'s own Expenses card and
-- report_cost_centre_costing()/report_tag_area_costing() already use —
-- deliberately NOT report_expense_analysis()/report_expense_budget()'s
-- definition (249/425), which includes COGS and is a real, separate,
-- narrower figure only the old "Expense Budget" tab reads. Checked against
-- an independent raw sum here, not against report_expense_analysis, since
-- those two are legitimately different numbers.
do $chk$
declare
  v_admin   uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_year    int  := extract(year from current_date)::int;
  v_result  jsonb;
  v_acct_total numeric;
  v_direct_total numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_expense_by_account(make_date(v_year,1,1), make_date(v_year,12,31)) into v_result;
  select coalesce(sum((r->>'expense')::numeric), 0) into v_acct_total from jsonb_array_elements(v_result) r;

  select coalesce(sum(l.debit - l.credit), 0) into v_direct_total
  from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
  where e.company_id = '96f6b539-b491-4df7-91a2-80c7c8e7491d' and e.status = 'posted'
    and a.type = 'expense' and coalesce(a.subtype, '') <> 'COGS' and a.is_postable
    and e.entry_date between make_date(v_year,1,1) and make_date(v_year,12,31);

  if abs(v_acct_total - v_direct_total) > 0.01 then
    raise exception 'report_expense_by_account self-check: total % does not match direct sum %', v_acct_total, v_direct_total;
  end if;

  select public.report_expense_budget_cc(v_year) into v_result;
  raise notice 'self-check passed: by_account total=%, budget_cc rows=%', v_acct_total, jsonb_array_length(v_result);
end;
$chk$;
