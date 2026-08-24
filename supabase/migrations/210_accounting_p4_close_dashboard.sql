-- ============================================================
-- VISTA ERP — Accounting rebuild, PHASE 4 (part 2)
-- Period lock + automatic year-end close + accounting dashboard.
-- ============================================================

create table if not exists acct_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  closed_through date
);
alter table acct_settings enable row level security;
drop policy if exists acct_settings_staff on acct_settings;
create policy acct_settings_staff on acct_settings for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- Period lock: gl_post refuses to post into a closed period.
create or replace function gl_post(
  p_company uuid, p_date date, p_memo text, p_doc_type text,
  p_source text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_no text; ln jsonb; d numeric(18,2); c numeric(18,2); v_closed date;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select closed_through into v_closed from acct_settings where company_id = p_company;
  if v_closed is not null and p_date <= v_closed then
    raise exception 'Period is closed through % — cannot post on %', v_closed, p_date;
  end if;
  perform gl_validate(p_company, p_lines);
  v_no := next_doc_number(p_company, p_doc_type);
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference)
  values (p_company, v_no, p_date, p_memo, 'posted', p_source, p_reference)
  returning id into v_entry;
  for ln in select * from jsonb_array_elements(p_lines) loop
    d := round(coalesce((ln->>'debit')::numeric, 0), 2);
    c := round(coalesce((ln->>'credit')::numeric, 0), 2);
    if d = 0 and c = 0 then continue; end if;
    insert into journal_lines(entry_id, account_id, description, debit, credit, cost_center, tag_area)
    values (v_entry, (ln->>'account_id')::uuid, ln->>'description', d, c, ln->>'cost_center', ln->>'tag_area');
  end loop;
  return jsonb_build_object('entry_id', v_entry, 'entry_no', v_no);
end $$;

-- Year-end close: zero every income/expense account into Retained Earnings (9-03) as of
-- the fiscal-year end, then lock the period. Balances carry forward automatically in the
-- continuous ledger, so no manual opening entries are needed.
create or replace function year_end_close(p_company uuid, p_fy_end date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_re uuid; lines jsonb := '[]'::jsonb; r record; net numeric(18,2) := 0; v jsonb;
begin
  if not is_admin() then raise exception 'Only an admin can run year-end close'; end if;
  select id into v_re from accounts where company_id = p_company and code = '9-03';
  if v_re is null then raise exception 'Retained Earnings (9-03) missing'; end if;

  for r in
    select a.id, a.type,
      coalesce(sum(l.debit - l.credit),0) as net_dr
    from accounts a
    left join journal_lines l on l.account_id = a.id
    left join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_fy_end
    where a.company_id = p_company and a.is_postable and a.type in ('income','expense')
    group by a.id, a.type
    having coalesce(sum(l.debit - l.credit),0) <> 0
  loop
    -- Reverse the account's balance (post the opposite side) so it becomes zero.
    lines := lines || jsonb_build_array(jsonb_build_object(
      'account_id', r.id::text,
      'debit',  case when r.net_dr < 0 then -r.net_dr else 0 end,
      'credit', case when r.net_dr > 0 then  r.net_dr else 0 end,
      'description', 'Year-end close'));
    net := net + r.net_dr;   -- sum of (debit-credit): >0 = net expense, <0 = net income
  end loop;

  if jsonb_array_length(lines) = 0 then raise exception 'Nothing to close for %', p_fy_end; end if;

  -- Plug Retained Earnings: net<0 means profit (credit RE); net>0 means loss (debit RE).
  lines := lines || jsonb_build_array(jsonb_build_object(
    'account_id', v_re::text,
    'debit',  case when net > 0 then net else 0 end,
    'credit', case when net < 0 then -net else 0 end,
    'description', 'Retained earnings — FY '||extract(year from p_fy_end)));

  v := gl_post(p_company, p_fy_end, 'Year-end close FY '||extract(year from p_fy_end), 'gl_journal', 'year_end', 'CLOSE', lines);
  insert into acct_settings(company_id, closed_through) values (p_company, p_fy_end)
    on conflict (company_id) do update set closed_through = greatest(acct_settings.closed_through, excluded.closed_through);
  perform acct_log(p_company, 'year_end_close', 'gl_journal', v->>'entry_no', jsonb_build_object('fy_end', p_fy_end, 'net_profit', -net));
  return jsonb_build_object('entry_no', v->>'entry_no', 'net_profit', -net);
end $$;

-- Accounting landing dashboard.
create or replace function acct_dashboard(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cash_bank', coalesce((
      select sum(l.debit - l.credit) from journal_lines l join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
      where e.company_id = p_company and e.status = 'posted' and a.subtype in ('Cash','Bank')), 0),
    'receivables', coalesce((select sum(outstanding_base) from open_items where company_id = p_company and status='open' and direction='D'), 0),
    'payables',    coalesce((select sum(outstanding_base) from open_items where company_id = p_company and status='open' and direction='C'), 0),
    'pending_approvals', coalesce((select count(*) from pending_vouchers where company_id = p_company and status='pending'), 0),
    'income', coalesce((select sum(l.credit - l.debit) from journal_lines l join journal_entries e on e.id=l.entry_id join accounts a on a.id=l.account_id where e.company_id=p_company and e.status='posted' and a.type='income'),0),
    'expense', coalesce((select sum(l.debit - l.credit) from journal_lines l join journal_entries e on e.id=l.entry_id join accounts a on a.id=l.account_id where e.company_id=p_company and e.status='posted' and a.type='expense'),0),
    'pdc_due_soon', coalesce((select count(*) from pdc_register where company_id=p_company and status in ('in_hand','deposited') and cheque_date <= current_date + 14), 0),
    'top_debtors', coalesce((select jsonb_agg(t) from (
      select a.name, sum(o.outstanding_base) amount from open_items o join accounts a on a.id=o.account_id
      where o.company_id=p_company and o.status='open' and o.direction='D' group by a.name order by amount desc limit 5) t), '[]'::jsonb),
    'top_creditors', coalesce((select jsonb_agg(t) from (
      select a.name, sum(o.outstanding_base) amount from open_items o join accounts a on a.id=o.account_id
      where o.company_id=p_company and o.status='open' and o.direction='C' group by a.name order by amount desc limit 5) t), '[]'::jsonb),
    'closed_through', (select closed_through from acct_settings where company_id = p_company)
  );
$$;

grant execute on function year_end_close(uuid,date) to authenticated;
grant execute on function acct_dashboard(uuid) to authenticated;
