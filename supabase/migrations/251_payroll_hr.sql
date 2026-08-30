-- 251_payroll_hr.sql
-- #21 Payroll & HR. Employee master (distinct from login profiles), a monthly
-- payroll run that generates payslips from each active employee's salary, and a
-- GL post: Dr Salaries & Wages (gross) / Cr Salary Payable (net) / Cr Staff
-- Deductions Payable (deductions). Employees are paid later via a Payment voucher
-- against Salary Payable.

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  emp_code text,
  name text not null,
  department text,
  designation text,
  join_date date,
  basic_salary numeric(18,2) not null default 0,
  allowances numeric(18,2) not null default 0,
  deductions numeric(18,2) not null default 0,
  bank_name text,
  bank_account text,
  iqama_no text,
  iqama_expiry date,
  profile_id uuid,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
alter table employees enable row level security;
drop policy if exists employees_staff on employees;
create policy employees_staff on employees for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

create table if not exists payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  period_year int not null,
  period_month int not null,
  status text not null default 'draft',   -- draft / posted
  gl_entry uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, period_year, period_month)
);
alter table payroll_runs enable row level security;
drop policy if exists payroll_runs_staff on payroll_runs;
create policy payroll_runs_staff on payroll_runs for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

create table if not exists payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id),
  basic numeric(18,2) not null default 0,
  allowances numeric(18,2) not null default 0,
  deductions numeric(18,2) not null default 0,
  net numeric(18,2) not null default 0
);
alter table payslips enable row level security;
drop policy if exists payslips_staff on payslips;
create policy payslips_staff on payslips for all to authenticated
  using (exists (select 1 from payroll_runs r where r.id = run_id and r.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from payroll_runs r where r.id = run_id and r.company_id = auth_company_id() and is_staff()));

-- Generate (or regenerate, while draft) payslips for a period from active employees.
create or replace function payroll_generate(p_year int, p_month int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); v_run uuid; v_status text; e employees%rowtype; n int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select id, status into v_run, v_status from payroll_runs where company_id = v_co and period_year = p_year and period_month = p_month;
  if v_run is null then
    insert into payroll_runs(company_id, period_year, period_month, created_by) values (v_co, p_year, p_month, auth.uid())
      returning id into v_run;
  elsif v_status = 'posted' then
    raise exception 'Payroll for this period is already posted';
  end if;
  delete from payslips where run_id = v_run;
  for e in select * from employees where company_id = v_co and status = 'active' loop
    insert into payslips(run_id, employee_id, basic, allowances, deductions, net)
    values (v_run, e.id, e.basic_salary, e.allowances, e.deductions, e.basic_salary + e.allowances - e.deductions);
    n := n + 1;
  end loop;
  return jsonb_build_object('run_id', v_run, 'employees', n);
end $$;

-- Post the run's payslips to the GL.
create or replace function payroll_post(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); r payroll_runs%rowtype; v_gross numeric(18,2); v_ded numeric(18,2); v_net numeric(18,2);
        v_exp uuid; v_pay uuid; v_dpay uuid; lines jsonb; g jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into r from payroll_runs where id = p_run and company_id = v_co;
  if not found then raise exception 'Run not found'; end if;
  if r.status = 'posted' then raise exception 'Already posted'; end if;
  select coalesce(sum(basic + allowances),0), coalesce(sum(deductions),0), coalesce(sum(net),0)
    into v_gross, v_ded, v_net from payslips where run_id = p_run;
  if v_gross <= 0 then raise exception 'Nothing to post — generate payslips first'; end if;

  v_exp  := acct_ensure_named(v_co, 'Salaries & Wages', 'expense', '5', 'Direct Expense');
  v_pay  := acct_ensure_named(v_co, 'Salary Payable', 'liability', '2', 'Payable');
  lines := jsonb_build_array(
    jsonb_build_object('account_id', v_exp::text, 'debit', v_gross, 'credit', 0, 'description', 'Payroll '||r.period_year||'-'||lpad(r.period_month::text,2,'0')),
    jsonb_build_object('account_id', v_pay::text, 'debit', 0, 'credit', v_net, 'description', 'Net salaries payable'));
  if v_ded > 0 then
    v_dpay := acct_ensure_named(v_co, 'Staff Deductions Payable', 'liability', '2', 'Payable');
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_dpay::text, 'debit', 0, 'credit', v_ded, 'description', 'Staff deductions'));
  end if;
  g := gl_post(v_co, make_date(r.period_year, r.period_month, 1), 'Payroll '||r.period_year||'-'||lpad(r.period_month::text,2,'0'), 'gl_payroll', 'PR-'||r.period_year||lpad(r.period_month::text,2,'0'), lines);
  update payroll_runs set status = 'posted', gl_entry = (g->>'entry_id')::uuid where id = p_run;
  return jsonb_build_object('posted', true, 'gross', v_gross, 'net', v_net, 'deductions', v_ded);
end $$;

grant execute on function payroll_generate(int, int) to authenticated;
grant execute on function payroll_post(uuid) to authenticated;
