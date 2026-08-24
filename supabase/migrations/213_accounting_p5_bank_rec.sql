-- Phase 5: bank reconciliation — statements + lines, auto-match, manual match, create-entry.
create table if not exists bank_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  bank_account_id uuid not null references accounts(id),
  statement_date date not null default current_date,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists bank_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references bank_statements(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  bank_account_id uuid not null references accounts(id),
  line_date date, description text, ref text,
  amount numeric(18,2) not null,
  matched_line_id uuid references journal_lines(id),
  status text not null default 'unmatched',
  created_at timestamptz not null default now()
);
create index if not exists idx_bank_lines_stmt on bank_lines(statement_id, status);
alter table bank_statements enable row level security;
alter table bank_lines      enable row level security;
drop policy if exists bank_stmt_staff on bank_statements;
create policy bank_stmt_staff on bank_statements for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());
drop policy if exists bank_lines_staff on bank_lines;
create policy bank_lines_staff on bank_lines for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

create or replace function bank_import(p_company uuid, p_bank_account uuid, p_statement_date date, p_note text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stmt uuid; ln jsonb; n int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  insert into bank_statements(company_id, bank_account_id, statement_date, note, created_by)
  values (p_company, p_bank_account, p_statement_date, p_note, auth.uid()) returning id into v_stmt;
  for ln in select * from jsonb_array_elements(p_lines) loop
    insert into bank_lines(statement_id, company_id, bank_account_id, line_date, description, ref, amount)
    values (v_stmt, p_company, p_bank_account, nullif(ln->>'date','')::date, ln->>'description', ln->>'ref', round((ln->>'amount')::numeric, 2));
    n := n + 1;
  end loop;
  return jsonb_build_object('statement_id', v_stmt, 'lines', n);
end $$;

create or replace function bank_automatch(p_company uuid, p_statement uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bl record; cand uuid; n int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  for bl in select * from bank_lines where statement_id = p_statement and status = 'unmatched' loop
    select l.id into cand from journal_lines l join journal_entries e on e.id = l.entry_id
    where e.company_id = p_company and e.status = 'posted' and l.account_id = bl.bank_account_id
      and round(l.debit - l.credit, 2) = bl.amount
      and (bl.line_date is null or abs(e.entry_date - bl.line_date) <= 5)
      and not exists (select 1 from bank_lines b2 where b2.matched_line_id = l.id)
    order by abs(e.entry_date - coalesce(bl.line_date, e.entry_date)) limit 1;
    if cand is not null then update bank_lines set matched_line_id = cand, status = 'matched' where id = bl.id; n := n + 1; end if;
  end loop;
  return jsonb_build_object('matched', n);
end $$;

create or replace function bank_match(p_company uuid, p_line uuid, p_journal_line uuid) returns void
language sql security definer set search_path = public as $$
  update bank_lines set matched_line_id = p_journal_line, status = 'matched' where id = p_line and company_id = p_company;
$$;
create or replace function bank_unmatch(p_company uuid, p_line uuid) returns void
language sql security definer set search_path = public as $$
  update bank_lines set matched_line_id = null, status = 'unmatched' where id = p_line and company_id = p_company;
$$;

create or replace function bank_create_entry(p_company uuid, p_line uuid, p_contra uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bl bank_lines%rowtype; v jsonb; lines jsonb; v_ll uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into bl from bank_lines where id = p_line and company_id = p_company;
  if not found then raise exception 'Line not found'; end if;
  if bl.amount >= 0 then
    lines := jsonb_build_array(
      jsonb_build_object('account_id', bl.bank_account_id::text, 'debit', bl.amount, 'credit', 0, 'description', bl.description),
      jsonb_build_object('account_id', p_contra::text, 'debit', 0, 'credit', bl.amount, 'description', bl.description));
  else
    lines := jsonb_build_array(
      jsonb_build_object('account_id', p_contra::text, 'debit', -bl.amount, 'credit', 0, 'description', bl.description),
      jsonb_build_object('account_id', bl.bank_account_id::text, 'debit', 0, 'credit', -bl.amount, 'description', bl.description));
  end if;
  v := gl_post(p_company, coalesce(bl.line_date, current_date), coalesce(bl.description,'Bank entry'), 'gl_journal', 'bank_rec', bl.ref, lines);
  select id into v_ll from journal_lines where entry_id = (v->>'entry_id')::uuid and account_id = bl.bank_account_id limit 1;
  update bank_lines set matched_line_id = v_ll, status = 'matched' where id = p_line;
  return jsonb_build_object('entry_no', v->>'entry_no');
end $$;

grant execute on function bank_import(uuid,uuid,date,text,jsonb) to authenticated;
grant execute on function bank_automatch(uuid,uuid) to authenticated;
grant execute on function bank_match(uuid,uuid,uuid) to authenticated;
grant execute on function bank_unmatch(uuid,uuid) to authenticated;
grant execute on function bank_create_entry(uuid,uuid,uuid) to authenticated;
