-- ============================================================
-- VISTA ERP — Accounting rebuild, PHASE 1
-- Master (Chart of Accounts) + single generic posting engine + voucher RPCs
-- + ledger/trial-balance read RPCs + Vista chart skeleton.
--
-- Design rules honoured here:
--   • ONE posting service (gl_post) — no document writes to the ledger directly.
--   • Balanced-or-nothing, in a single transaction; groups are never postable.
--   • Ledger (journal_entries/journal_lines) stays append-only; edits are reversals.
--   • Base currency = SAR (this is a fresh accounting go-live).
-- 'control' nature was added in the previous migration so it is usable here.
-- ============================================================

-- Base currency → SAR (foreign: PKR, USD). Ensure the rows exist first.
insert into currencies(code, name) values
  ('SAR','Saudi Riyal'), ('PKR','Pak Rupee'), ('USD','US Dollar')
  on conflict (code) do nothing;
update companies set base_currency = 'SAR' where base_currency <> 'SAR';

-- ── Master extensions ───────────────────────────────────────
alter table accounts add column if not exists name_ar     text;
alter table accounts add column if not exists is_group    boolean not null default false;
alter table accounts add column if not exists subtype     text;      -- Cash/Bank/Receivable/Payable/Tax/Revenue/COGS/...
alter table accounts add column if not exists currency    char(3) not null default 'SAR';
alter table accounts add column if not exists opening_balance  numeric(18,2) not null default 0;
alter table accounts add column if not exists opening_is_debit boolean not null default true;
alter table accounts add column if not exists status      text not null default 'active';  -- active/inactive/frozen
alter table accounts add column if not exists sort_order  int not null default 0;
alter table accounts add column if not exists notes       text;
alter table accounts add column if not exists path        text;      -- materialized path of codes (rollups)

-- Existing containers (non-postable) become groups.
update accounts set is_group = true  where is_postable = false and is_group = false;
update accounts set is_group = false where is_postable = true  and is_group = true;

-- Analytic dimensions on ledger lines (nullable in Phase 1).
alter table journal_lines add column if not exists cost_center text;
alter table journal_lines add column if not exists tag_area    text;

-- ── Materialized path maintenance ───────────────────────────
create or replace function acct_set_path() returns trigger
language plpgsql as $$
begin
  if new.parent_id is null then
    new.path := new.code;
  else
    select p.path || '/' || new.code into new.path from accounts p where p.id = new.parent_id;
    if new.path is null then new.path := new.code; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_acct_path on accounts;
create trigger trg_acct_path before insert or update of parent_id, code on accounts
  for each row execute function acct_set_path();

-- Rebuild every path top-down (used after seeding / bulk regroup).
create or replace function acct_rebuild_paths(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  with recursive t as (
    select id, code, code::text as path from accounts
      where company_id = p_company and parent_id is null
    union all
    select a.id, a.code, t.path || '/' || a.code
      from accounts a join t on a.parent_id = t.id
      where a.company_id = p_company
  )
  update accounts a set path = t.path from t where a.id = t.id;
end $$;

-- ── Generic posting service — the ONLY writer to the ledger ──
-- p_lines: jsonb array of {account_id, debit, credit, description, cost_center, tag_area}
create or replace function gl_post(
  p_company uuid, p_date date, p_memo text, p_doc_type text,
  p_source text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entry uuid; v_no text; ln jsonb;
  v_debit numeric(18,2) := 0; v_credit numeric(18,2) := 0; v_count int := 0;
  v_acc uuid; d numeric(18,2); c numeric(18,2); a accounts%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A voucher needs at least two lines';
  end if;

  -- Validate every line before writing anything.
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_acc := (ln->>'account_id')::uuid;
    d := round(coalesce((ln->>'debit')::numeric, 0), 2);
    c := round(coalesce((ln->>'credit')::numeric, 0), 2);
    if d < 0 or c < 0 then raise exception 'Amounts cannot be negative'; end if;
    if d > 0 and c > 0 then raise exception 'A line cannot be both debit and credit'; end if;
    if d = 0 and c = 0 then continue; end if;   -- skip empty lines
    select * into a from accounts where id = v_acc and company_id = p_company;
    if not found then raise exception 'Account not found on this company'; end if;
    if a.is_group or not a.is_postable then raise exception 'Cannot post to a group account (%)', a.name; end if;
    if a.status <> 'active' then raise exception 'Account % is % — posting blocked', a.name, a.status; end if;
    v_debit := v_debit + d; v_credit := v_credit + c; v_count := v_count + 1;
  end loop;

  if v_count < 2 then raise exception 'A voucher needs at least two non-zero lines'; end if;
  if v_debit <> v_credit then
    raise exception 'Voucher out of balance: debit % ≠ credit %', v_debit, v_credit;
  end if;
  if v_debit = 0 then raise exception 'Voucher total cannot be zero'; end if;

  v_no := next_doc_number(p_company, p_doc_type);
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference)
  values (p_company, v_no, p_date, p_memo, 'posted', p_source, p_reference)
  returning id into v_entry;

  for ln in select * from jsonb_array_elements(p_lines) loop
    d := round(coalesce((ln->>'debit')::numeric, 0), 2);
    c := round(coalesce((ln->>'credit')::numeric, 0), 2);
    if d = 0 and c = 0 then continue; end if;
    insert into journal_lines(entry_id, account_id, description, debit, credit, cost_center, tag_area)
    values (v_entry, (ln->>'account_id')::uuid, ln->>'description', d, c,
            ln->>'cost_center', ln->>'tag_area');
  end loop;

  return jsonb_build_object('entry_id', v_entry, 'entry_no', v_no);
end $$;

-- ── Voucher wrappers (build lines, then call the one engine) ─
-- Receipt: money IN. Dr cash/bank (sum), Cr each listed account.
-- p_lines: [{account, amount, remarks}]
create or replace function gl_receipt(
  p_company uuid, p_date date, p_cash_bank uuid, p_narration text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare ln jsonb; arr jsonb := '[]'::jsonb; total numeric(18,2) := 0; amt numeric(18,2);
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric,0),2);
    if amt = 0 then continue; end if;
    total := total + amt;
    arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', 0, 'credit', amt,
                                     'description', ln->>'remarks'));
  end loop;
  arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', total, 'credit', 0,
                            'description', p_narration)) || arr;
  return gl_post(p_company, p_date, p_narration, 'gl_receipt', 'receipt', p_reference, arr);
end $$;

-- Payment: money OUT. Cr cash/bank (sum), Dr each listed account.
create or replace function gl_payment(
  p_company uuid, p_date date, p_cash_bank uuid, p_narration text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare ln jsonb; arr jsonb := '[]'::jsonb; total numeric(18,2) := 0; amt numeric(18,2);
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    amt := round(coalesce((ln->>'amount')::numeric,0),2);
    if amt = 0 then continue; end if;
    total := total + amt;
    arr := arr || jsonb_build_array(jsonb_build_object('account_id', ln->>'account', 'debit', amt,
                                     'credit', 0, 'description', ln->>'remarks'));
  end loop;
  arr := jsonb_build_array(jsonb_build_object('account_id', p_cash_bank::text, 'debit', 0, 'credit', total,
                            'description', p_narration)) || arr;
  return gl_post(p_company, p_date, p_narration, 'gl_payment', 'payment', p_reference, arr);
end $$;

-- Contra: move between two cash/bank accounts. Dr to, Cr from.
create or replace function gl_contra(
  p_company uuid, p_date date, p_from uuid, p_to uuid, p_amount numeric, p_narration text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare arr jsonb;
begin
  arr := jsonb_build_array(
    jsonb_build_object('account_id', p_to::text,   'debit', p_amount, 'credit', 0, 'description', p_narration),
    jsonb_build_object('account_id', p_from::text, 'debit', 0, 'credit', p_amount, 'description', p_narration));
  return gl_post(p_company, p_date, p_narration, 'gl_contra', 'contra', null, arr);
end $$;

-- Journal: direct balanced lines. p_lines: [{account, debit, credit, remarks}]
create or replace function gl_journal(
  p_company uuid, p_date date, p_narration text, p_reference text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare ln jsonb; arr jsonb := '[]'::jsonb;
begin
  for ln in select * from jsonb_array_elements(p_lines) loop
    arr := arr || jsonb_build_array(jsonb_build_object(
      'account_id', ln->>'account',
      'debit',  round(coalesce((ln->>'debit')::numeric,0),2),
      'credit', round(coalesce((ln->>'credit')::numeric,0),2),
      'description', ln->>'remarks',
      'cost_center', ln->>'cost_center', 'tag_area', ln->>'tag_area'));
  end loop;
  return gl_post(p_company, p_date, p_narration, 'gl_journal', 'journal', p_reference, arr);
end $$;

-- ── Read RPCs ───────────────────────────────────────────────
-- Whole tree with each account's OWN posted debit/credit; the app rolls up groups by path.
create or replace function acct_tree(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'code', a.code, 'name', a.name, 'name_ar', a.name_ar,
    'nature', a.type, 'is_group', a.is_group, 'is_postable', a.is_postable,
    'parent_id', a.parent_id, 'path', a.path, 'currency', a.currency,
    'subtype', a.subtype, 'status', a.status, 'sort_order', a.sort_order,
    'own_debit', coalesce(s.debit,0), 'own_credit', coalesce(s.credit,0)
  ) order by a.path), '[]'::jsonb)
  from accounts a
  left join (
    select l.account_id, sum(l.debit) debit, sum(l.credit) credit
    from journal_lines l join journal_entries e on e.id = l.entry_id
    where e.company_id = p_company and e.status = 'posted'
    group by l.account_id
  ) s on s.account_id = a.id
  where a.company_id = p_company;
$$;

-- Ledger for one or more accounts over a date range: opening + ordered rows.
create or replace function acct_ledger(
  p_company uuid, p_account_ids uuid[], p_from date, p_to date
) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'opening', coalesce((
      select sum(l.debit - l.credit) from journal_lines l
      join journal_entries e on e.id = l.entry_id
      where e.company_id = p_company and e.status = 'posted'
        and l.account_id = any(p_account_ids)
        and (p_from is null or e.entry_date < p_from)
    ), 0),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', e.entry_date, 'entry_no', e.entry_no, 'account_id', l.account_id,
        'account', a.code || ' · ' || a.name, 'memo', coalesce(l.description, e.memo),
        'reference', e.reference, 'debit', l.debit, 'credit', l.credit
      ) order by e.entry_date, e.entry_no, l.created_at)
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
      where e.company_id = p_company and e.status = 'posted'
        and l.account_id = any(p_account_ids)
        and (p_from is null or e.entry_date >= p_from)
        and (p_to   is null or e.entry_date <= p_to)
    ), '[]'::jsonb)
  );
$$;

-- Trial balance as-of / for a period: per postable account with opening + period, split Dr/Cr.
create or replace function trial_balance(
  p_company uuid, p_from date, p_to date
) returns jsonb language sql stable security definer set search_path = public as $$
  with agg as (
    select a.id, a.code, a.name, a.type as nature,
      coalesce(sum(l.debit - l.credit) filter (where p_from is null or e.entry_date < p_from),0) as opening_net,
      coalesce(sum(l.debit)  filter (where (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)),0) as period_debit,
      coalesce(sum(l.credit) filter (where (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)),0) as period_credit
    from accounts a
    left join journal_lines l on l.account_id = a.id
    left join journal_entries e on e.id = l.entry_id and e.company_id = p_company and e.status = 'posted'
    where a.company_id = p_company and a.is_postable
    group by a.id, a.code, a.name, a.type
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'code', code, 'name', name, 'nature', nature,
    'opening_debit',  case when opening_net > 0 then opening_net else 0 end,
    'opening_credit', case when opening_net < 0 then -opening_net else 0 end,
    'period_debit', period_debit, 'period_credit', period_credit,
    'closing_net', opening_net + period_debit - period_credit
  ) order by code), '[]'::jsonb)
  from agg
  where opening_net <> 0 or period_debit <> 0 or period_credit <> 0;
$$;

grant execute on function gl_post(uuid,date,text,text,text,text,jsonb) to authenticated;
grant execute on function gl_receipt(uuid,date,uuid,text,text,jsonb) to authenticated;
grant execute on function gl_payment(uuid,date,uuid,text,text,jsonb) to authenticated;
grant execute on function gl_contra(uuid,date,uuid,uuid,numeric,text) to authenticated;
grant execute on function gl_journal(uuid,date,text,text,jsonb) to authenticated;
grant execute on function acct_tree(uuid) to authenticated;
grant execute on function acct_ledger(uuid,uuid[],date,date) to authenticated;
grant execute on function trial_balance(uuid,date,date) to authenticated;
grant execute on function acct_rebuild_paths(uuid) to authenticated;
