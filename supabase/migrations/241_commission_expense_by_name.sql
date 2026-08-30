-- 241_commission_expense_by_name.sql
-- Fix: the fixed code '5-06' was already used (Depreciation) in the seeded chart,
-- so acct_seed_node('5-06', 'Sales Commission') was a no-op and commission would
-- have posted to the wrong account. Resolve the commission expense account by
-- NAME ('Sales Commission') instead, and create it under group 5 with the next
-- free code, per company.
do $$
declare co uuid; par accounts%rowtype; v_seq int; v_code text;
begin
  for co in select distinct company_id from accounts loop
    if not exists (select 1 from accounts where company_id = co and type = 'expense' and upper(name) = 'SALES COMMISSION') then
      select * into par from accounts where company_id = co and code = '5';
      if found then
        select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
          from accounts where company_id = co and parent_id = par.id and code ~ '^5-[0-9]+$';
        v_code := '5-' || lpad(coalesce(v_seq,1)::text, 2, '0');
        insert into accounts(company_id, code, name, type, is_postable, is_group, parent_id, subtype)
        values (co, v_code, 'Sales Commission', 'expense', true, false, par.id, 'Indirect Expense');
      end if;
    end if;
    perform acct_rebuild_paths(co);
  end loop;
end $$;

-- Resolve the commission expense by name, not by code.
create or replace function commission_accrue(
  p_company uuid, p_source_ref text, p_date date, p_cost_center text,
  p_salesperson uuid, p_base numeric, p_units numeric default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare r commission_rules%rowtype; v_amt numeric(18,2); v_exp uuid; v_pay uuid; lines jsonb;
begin
  if p_salesperson is null or p_cost_center is null then return 0; end if;
  select * into r from commission_rules
    where company_id = p_company and salesperson_id = p_salesperson and cost_center = p_cost_center and is_active limit 1;
  if not found then return 0; end if;

  v_amt := case r.method
    when 'percent'  then round(coalesce(p_base,0) * r.rate / 100.0, 2)
    when 'fixed'    then round(r.rate, 2)
    when 'per_unit' then round(r.rate * coalesce(p_units,0), 2)
    else 0 end;
  if coalesce(v_amt,0) <= 0 then return 0; end if;

  select id into v_exp from accounts where company_id = p_company and type = 'expense' and upper(name) = 'SALES COMMISSION'
    and is_postable order by code limit 1;
  v_pay := ensure_salesperson_account(p_company, p_salesperson);
  if v_exp is null or v_pay is null then return 0; end if;

  lines := jsonb_build_array(
    jsonb_build_object('account_id', v_exp::text, 'debit', v_amt, 'credit', 0,
      'description', 'Commission '|| p_cost_center, 'cost_center', p_cost_center),
    jsonb_build_object('account_id', v_pay::text, 'debit', 0, 'credit', v_amt,
      'description', 'Commission '|| p_cost_center, 'cost_center', p_cost_center));
  perform gl_post(p_company, p_date, 'Auto commission — '|| p_cost_center,
    'gl_commission_accrual', p_source_ref, lines);
  return v_amt;
end $$;

grant execute on function commission_accrue(uuid, text, date, text, uuid, numeric, numeric) to authenticated;
