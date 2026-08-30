-- 240_commission_automation.sql
-- Accounting Phase 3 — replace the manual Commission Voucher with automatic
-- commission accrual. A salesperson is credited automatically when an invoice
-- is posted under a cost center they earn commission on: Dr Sales Commission
-- (expense), Cr <Salesperson> (payable). Rules are per salesperson per cost
-- center and can be a percentage of the invoice, a fixed amount, or per-unit.

-- ── Remove the manual Commission Voucher (superseded by automation) ──────────
drop function if exists gl_commission(uuid, date, uuid, text, text, jsonb);
-- gl_petty stays a manual voucher; gl_commission is gone.
create or replace function acct_is_manual_voucher(p_source text)
 returns boolean language sql immutable
as $$ select p_source in ('gl_receipt','gl_payment','gl_contra','gl_journal','gl_petty') $$;

-- ── Control accounts (per company): Commission Payable group + expense leaf ──
do $$
declare co uuid;
begin
  for co in select distinct company_id from accounts loop
    perform acct_seed_node(co, '2-01-02', 'COMMISSION PAYABLE', 'liability', '2-01', true);
    perform acct_seed_node(co, '5-06', 'Sales Commission', 'expense', '5', false, 'Indirect Expense');
    perform acct_rebuild_paths(co);
  end loop;
end $$;

-- ── Salesperson master ──────────────────────────────────────────────────────
create table if not exists salespersons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  phone text,
  account_id uuid references accounts(id),   -- auto commission-payable ledger
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table salespersons enable row level security;
drop policy if exists salespersons_staff on salespersons;
create policy salespersons_staff on salespersons for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- Commission rules: per salesperson, per cost center, one method + rate.
create table if not exists commission_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  salesperson_id uuid not null references salespersons(id) on delete cascade,
  cost_center text not null,
  method text not null default 'percent' check (method in ('percent','fixed','per_unit')),
  rate numeric(18,4) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, salesperson_id, cost_center)
);
alter table commission_rules enable row level security;
drop policy if exists commission_rules_staff on commission_rules;
create policy commission_rules_staff on commission_rules for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- ── Ensure a payable ledger for a salesperson (child of 2-01-02) ─────────────
create or replace function ensure_salesperson_account(p_company uuid, p_salesperson uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_acc uuid; par accounts%rowtype; sp salespersons%rowtype; v_seq int; v_code text;
begin
  select * into sp from salespersons where id = p_salesperson and company_id = p_company;
  if not found then raise exception 'Salesperson not found'; end if;
  if sp.account_id is not null then return sp.account_id; end if;

  select * into par from accounts where company_id = p_company and code = '2-01-02';
  if not found then
    perform acct_seed_node(p_company, '2-01-02', 'COMMISSION PAYABLE', 'liability', '2-01', true);
    perform acct_rebuild_paths(p_company);
    select * into par from accounts where company_id = p_company and code = '2-01-02';
  end if;

  select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
    from accounts where company_id = p_company and parent_id = par.id and code ~ '-[0-9]+$';
  v_code := par.code || '-' || lpad(coalesce(v_seq,1)::text, 3, '0');

  insert into accounts(company_id, code, name, type, is_postable, is_group, parent_id, subtype, currency, phone)
  values (p_company, v_code, sp.name, 'liability', true, false, par.id, 'Payable', 'SAR', sp.phone)
  returning id into v_acc;
  update salespersons set account_id = v_acc where id = p_salesperson;
  perform acct_rebuild_paths(p_company);
  return v_acc;
end $$;

-- ── Accrue commission for an invoice, per the salesperson's rule ─────────────
-- p_base = invoice net (used by 'percent'); p_units = quantity (used by 'per_unit').
-- Posts Dr 5-06 Sales Commission / Cr <salesperson payable>, tagged with the
-- cost center, linked by reference to the source document. Returns the amount
-- accrued (0 when there is no active rule). Safe to call unconditionally.
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

  select id into v_exp from accounts where company_id = p_company and code = '5-06';
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

grant execute on function ensure_salesperson_account(uuid, uuid) to authenticated;
grant execute on function commission_accrue(uuid, text, date, text, uuid, numeric, numeric) to authenticated;

-- ── Wire commission into the generic Sales Invoice / Purchase Bill ───────────
-- Adds cost center (tags the revenue/expense line) and salesperson (customer
-- sales only) to party_invoice, then auto-accrues commission after posting.
drop function if exists party_invoice(uuid,uuid,text,date,date,text,numeric,uuid,numeric,text,boolean);
create or replace function party_invoice(
  p_company uuid, p_party uuid, p_kind text, p_date date, p_due date, p_narration text,
  p_amount numeric, p_income_expense_account uuid, p_tax numeric, p_reference text,
  p_override_credit boolean default false, p_cost_center text default null, p_salesperson uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_out_vat uuid; v_in_vat uuid; total numeric(18,2); v jsonb; lines jsonb; v_open uuid;
        v_limit numeric(18,2); v_out numeric(18,2); v_doc text; v_comm numeric(18,2) := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be positive'; end if;
  v_acc := ensure_party_account(p_company, p_party, p_kind);
  total := round(coalesce(p_amount,0),2) + round(coalesce(p_tax,0),2);
  select id into v_out_vat from accounts where company_id = p_company and code = '2-02';
  select id into v_in_vat  from accounts where company_id = p_company and code = '2-03';

  if p_kind = 'customer' then
    if not p_override_credit then
      select credit_limit into v_limit from accounts where id = v_acc;
      if coalesce(v_limit,0) > 0 then
        select coalesce(sum(outstanding_base),0) into v_out from open_items
          where account_id = v_acc and status = 'open' and direction = 'D';
        if v_out + total > v_limit then
          raise exception 'Credit limit exceeded: outstanding % + % > limit %', v_out, total, v_limit;
        end if;
      end if;
    end if;
    v_doc := 'gl_sales';
    lines := jsonb_build_array(
      jsonb_build_object('account_id', v_acc::text, 'debit', total, 'credit', 0, 'description', p_narration),
      jsonb_build_object('account_id', p_income_expense_account::text, 'debit', 0, 'credit', round(p_amount,2), 'description', p_narration, 'cost_center', p_cost_center));
    if coalesce(p_tax,0) > 0 and v_out_vat is not null then
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_out_vat::text, 'debit', 0, 'credit', round(p_tax,2), 'description', 'Output VAT 15%'));
    end if;
  else
    v_doc := 'gl_purchase';
    lines := jsonb_build_array(
      jsonb_build_object('account_id', v_acc::text, 'debit', 0, 'credit', total, 'description', p_narration),
      jsonb_build_object('account_id', p_income_expense_account::text, 'debit', round(p_amount,2), 'credit', 0, 'description', p_narration, 'cost_center', p_cost_center));
    if coalesce(p_tax,0) > 0 and v_in_vat is not null then
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_in_vat::text, 'debit', round(p_tax,2), 'credit', 0, 'description', 'Input VAT 15%'));
    end if;
  end if;

  v := gl_post(p_company, p_date, p_narration, v_doc, v_doc, p_reference, lines);
  insert into open_items(company_id, account_id, party_id, direction, doc_type, doc_no, doc_date, due_date,
                         currency, amount_base, outstanding_base, entry_id)
  values (p_company, v_acc, p_party, case when p_kind='customer' then 'D' else 'C' end, v_doc,
          v->>'entry_no', p_date, p_due, 'SAR', total, total, (v->>'entry_id')::uuid)
  returning id into v_open;
  perform acct_log(p_company, 'posted', v_doc, v->>'entry_no', jsonb_build_object('amount', total, 'party', p_party));

  if p_kind = 'customer' then
    v_comm := commission_accrue(p_company, v->>'entry_no', p_date, p_cost_center, p_salesperson, round(p_amount,2), null);
  end if;
  return jsonb_build_object('entry_no', v->>'entry_no', 'account_id', v_acc, 'open_item_id', v_open, 'total', total, 'commission', v_comm);
end $$;

grant execute on function party_invoice(uuid,uuid,text,date,date,text,numeric,uuid,numeric,text,boolean,text,uuid) to authenticated;
