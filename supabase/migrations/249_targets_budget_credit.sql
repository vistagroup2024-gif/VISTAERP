-- 249_targets_budget_credit.sql
-- Phase 5 — targets, budgets & credit.
--  #16 cost-center sales target report (target already on acct_cost_centers)
--  #23 customer sales target + report
--  #22 expense budget (per expense account, per year) + report
--  #24 credit limit + credit days on customers/suppliers (synced to the ledger)

alter table parties add column if not exists sales_target numeric(18,2) not null default 0;
alter table parties add column if not exists credit_days int not null default 0;

-- Keep the party ledger's credit limit / days in sync with the party master.
create or replace function ensure_party_account(p_company uuid, p_party uuid, p_kind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_acc uuid; par accounts%rowtype; v_seq int; v_code text; pr parties%rowtype; v_parent_code text; v_subtype text; v_nature account_type;
begin
  select * into pr from parties where id = p_party and company_id = p_company;
  if not found then raise exception 'Party not found'; end if;

  select id into v_acc from accounts where company_id = p_company and party_id = p_party
    and subtype = case when p_kind = 'supplier' then 'Payable' else 'Receivable' end limit 1;
  if v_acc is not null then
    update accounts set credit_limit = coalesce(pr.credit_limit,0), credit_days = coalesce(pr.credit_days,0) where id = v_acc;
    return v_acc;
  end if;

  if p_kind = 'supplier' then v_parent_code := '2-01-01'; v_subtype := 'Payable'; v_nature := 'liability';
  else v_parent_code := '1-04-01'; v_subtype := 'Receivable'; v_nature := 'asset'; end if;

  select * into par from accounts where company_id = p_company and code = v_parent_code;
  if not found then raise exception 'Control group % missing — seed the chart', v_parent_code; end if;

  select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
    from accounts where company_id = p_company and parent_id = par.id and code ~ '-[0-9]+$';
  v_code := par.code || '-' || lpad(coalesce(v_seq,1)::text, 3, '0');

  insert into accounts(company_id, code, name, type, is_postable, is_group, parent_id, subtype,
                       currency, party_id, phone, vat_no, credit_limit, credit_days)
  values (p_company, v_code, pr.name, v_nature, true, false, par.id, v_subtype,
          coalesce(pr.currency,'SAR'), p_party, pr.phone, pr.tax_number, coalesce(pr.credit_limit,0), coalesce(pr.credit_days,0))
  returning id into v_acc;
  return v_acc;
end $$;

-- Expense budget: per expense account, per calendar year.
create table if not exists acct_expense_budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  account_id uuid not null references accounts(id) on delete cascade,
  year int not null,
  amount numeric(18,2) not null default 0,
  unique (company_id, account_id, year)
);
alter table acct_expense_budgets enable row level security;
drop policy if exists aeb_staff on acct_expense_budgets;
create policy aeb_staff on acct_expense_budgets for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- #16 Cost-center sales target vs actual income (by cost_center tag) for a period.
create or replace function report_cost_center_targets(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'cost_center', cc.name, 'target', cc.sales_target, 'actual', coalesce(a.actual,0),
    'variance', coalesce(a.actual,0) - cc.sales_target) order by cc.name), '[]'::jsonb)
  from acct_cost_centers cc
  left join (
    select l.cost_center, sum(l.credit - l.debit) actual
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts ac on ac.id = l.account_id
    where e.company_id = auth_company_id() and e.status = 'posted' and ac.type = 'income'
      and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
    group by l.cost_center) a on a.cost_center = cc.name
  where cc.company_id = auth_company_id() and cc.is_group = false;
$$;

-- #23 Customer sales target vs actual invoiced sales for a period.
create or replace function report_customer_targets(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer', p.name, 'target', p.sales_target, 'actual', coalesce(a.actual,0),
    'variance', coalesce(a.actual,0) - p.sales_target) order by p.name), '[]'::jsonb)
  from parties p
  left join (
    select oi.party_id, sum(oi.amount_base) actual from open_items oi
    where oi.company_id = auth_company_id() and oi.direction = 'D'
      and (p_from is null or oi.doc_date >= p_from) and (p_to is null or oi.doc_date <= p_to)
    group by oi.party_id) a on a.party_id = p.id
  where p.company_id = auth_company_id() and p.is_active and p.party_type in ('customer','b2b_agent')
    and (p.sales_target > 0 or coalesce(a.actual,0) > 0);
$$;

-- #22 Expense budget vs actual for a year.
create or replace function report_expense_budget(p_year int)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', ac.id, 'code', ac.code, 'name', ac.name,
    'budget', coalesce(b.amount,0), 'actual', coalesce(a.actual,0),
    'variance', coalesce(b.amount,0) - coalesce(a.actual,0)) order by ac.code), '[]'::jsonb)
  from accounts ac
  left join acct_expense_budgets b on b.account_id = ac.id and b.year = p_year and b.company_id = auth_company_id()
  left join (
    select l.account_id, sum(l.debit - l.credit) actual
    from journal_lines l join journal_entries e on e.id = l.entry_id
    where e.company_id = auth_company_id() and e.status = 'posted' and extract(year from e.entry_date) = p_year
    group by l.account_id) a on a.account_id = ac.id
  where ac.company_id = auth_company_id() and ac.type = 'expense' and ac.is_postable
    and (coalesce(b.amount,0) > 0 or coalesce(a.actual,0) > 0);
$$;

grant execute on function report_cost_center_targets(date, date) to authenticated;
grant execute on function report_customer_targets(date, date) to authenticated;
grant execute on function report_expense_budget(int) to authenticated;

-- Re-sync existing party ledgers' credit fields from the master.
do $$
declare p record;
begin
  for p in select id, company_id, party_type from parties where is_active loop
    begin perform ensure_party_account(p.company_id, p.id, case when p.party_type='supplier' then 'supplier' else 'customer' end); exception when others then null; end;
  end loop;
end $$;
