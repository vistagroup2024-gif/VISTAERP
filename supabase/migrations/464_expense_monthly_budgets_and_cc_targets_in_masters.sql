-- Targets & Budget moves off its own screen and into the masters it was
-- always describing: a cost centre's sales target is edited on the Cost
-- Centre master's own new Targets tab (components/accounting/TreeMaster.tsx),
-- and an expense account's budget is edited on the Chart of Accounts' own
-- new Budget tab (components/accounting/AccountTree.tsx) — both requested
-- directly ("these should be in master... in cost centers need targets tab...
-- in chart of account under expense group account need tab of budget").
--
-- Cost Centre targets needed NO schema change: acct_cost_center_monthly_targets
-- (436) is already the real (cost_center, year, month) grid every report
-- already reads — only WHERE it's edited moved.
--
-- Expense budgets DID need one: the two existing budget tables were both the
-- wrong shape for "type an annual figure, have it divide into months, but
-- edit any month by hand" —
--   acct_expense_budgets       (249) account + year only, no cost centre
--   acct_expense_budgets_cc    (440) account + cost_centre + year, but a
--                               single FLAT "monthly_amount" recurring figure
--                               (Yearly was always Monthly x 12, never a real
--                               12-cell grid — the migration's own comment
--                               says so).
-- Neither is dropped — both stay in the schema, inert, the same "never
-- delete, make inert" rule this codebase already applies to
-- acct_cost_centers.sales_target (436) and report_expense_by_account (441).
-- acct_expense_monthly_budgets is the new, real grid, the exact shape
-- acct_cost_center_monthly_targets already proved for sales targets, just
-- with an account dimension added.
create table if not exists public.acct_expense_monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  cost_center_id uuid not null references public.acct_cost_centers(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  amount numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, account_id, cost_center_id, year, month)
);

alter table public.acct_expense_monthly_budgets enable row level security;

-- Restricted on both dimensions, exactly like acct_expense_budgets_cc was —
-- a user who may not see this account or may not see this cost centre may
-- not see (or write) a budget crossing either.
create policy acct_expense_monthly_budgets_staff on public.acct_expense_monthly_budgets
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

-- Seed the new grid from whatever the old flat-recurring table already held,
-- so a budget somebody already typed on the Expense Report's own "Monthly
-- and Yearly Budgets" panel isn't lost — twelve equal months at that row's
-- own monthly_amount, exactly what "recurring" already meant, now stored as
-- twelve real rows a viewer can then hand-edit individually. Idempotent: a
-- re-run of this migration (or a row already seeded another way) is skipped
-- by the unique constraint, never duplicated.
insert into public.acct_expense_monthly_budgets (company_id, account_id, cost_center_id, year, month, amount)
select b.company_id, b.account_id, b.cost_center_id, b.year, m.month, b.monthly_amount
from public.acct_expense_budgets_cc b
cross join generate_series(1, 12) as m(month)
on conflict (company_id, account_id, cost_center_id, year, month) do nothing;

-- report_expense_budget_cc() keeps its name and its (account, cost_centre)
-- cross-join completeness (every postable expense account x every leaf cost
-- centre, so the Expense Report's own display always has every cell), but
-- now reads the real monthly grid instead of the flat table: monthly_amount
-- is the true average (kept for the existing "Monthly" column's own shape)
-- and the new yearly_amount is the true sum, not Monthly x 12 — the two can
-- differ now that a year's months are no longer forced identical.
create or replace function public.report_expense_budget_cc(p_year int)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with monthly as (
    select account_id, cost_center_id, sum(amount) as yearly_amount
    from acct_expense_monthly_budgets
    where company_id = auth_company_id() and year = p_year
    group by account_id, cost_center_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', ac.id, 'account_name', ac.name, 'account_group', coalesce(apg.name, ac.name),
      'cost_center_id', cc.id, 'cost_center', cc.name,
      'monthly_amount', round(coalesce(mo.yearly_amount, 0) / 12, 2),
      'yearly_amount', coalesce(mo.yearly_amount, 0)
    ) order by ac.name, cc.name), '[]'::jsonb)
  from accounts ac
  left join accounts apg on apg.id = ac.parent_id
  cross join acct_cost_centers cc
  left join monthly mo on mo.account_id = ac.id and mo.cost_center_id = cc.id
  where ac.company_id = auth_company_id() and ac.type = 'expense' and ac.is_postable
    and cc.company_id = auth_company_id() and cc.is_group = false
    and (staff_scope_ids('account') is null or ac.id = any (staff_scope_ids('account')::uuid[]))
    and (staff_scope_ids('cost_center') is null or cc.id = any (staff_scope_ids('cost_center')::uuid[]));
$function$;

revoke all on function public.report_expense_budget_cc(int) from public, anon;
grant execute on function public.report_expense_budget_cc(int) to authenticated;

do $chk$
declare
  v_admin  uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_year   int  := extract(year from current_date)::int;
  v_before numeric;
  v_after  numeric;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select coalesce(sum(monthly_amount * 12), 0) into v_before
  from acct_expense_budgets_cc where company_id = '96f6b539-b491-4df7-91a2-80c7c8e7491d' and year = v_year;

  select coalesce(sum((r->>'yearly_amount')::numeric), 0) into v_after
  from jsonb_array_elements(public.report_expense_budget_cc(v_year)) r;

  if abs(v_before - v_after) > 0.01 then
    raise exception 'expense budget migration self-check: old flat total % does not match new monthly-grid total %', v_before, v_after;
  end if;
  raise notice 'self-check passed: budget totals agree before/after = %', v_after;
end;
$chk$;
