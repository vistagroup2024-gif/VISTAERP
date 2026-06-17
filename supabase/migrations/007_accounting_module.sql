-- ============================================================
-- VISTA ERP - 007 Accounting (double-entry GL, receipts, posting)
-- All amounts in journal_lines are in the company base currency.
-- ============================================================

create type account_type as enum ('asset','liability','equity','income','expense');
create type je_status   as enum ('draft','posted','void');
create type payment_type as enum ('receipt','payment');

create table accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  code        text not null,
  name        text not null,
  type        account_type not null,
  is_postable boolean not null default true,
  parent_id   uuid references accounts(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (company_id, code)
);
create index idx_accounts_company on accounts(company_id);

create table journal_entries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  entry_no    text not null,
  entry_date  date not null default current_date,
  memo        text,
  status      je_status not null default 'posted',
  source      text,
  reference   text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (company_id, entry_no)
);
create index idx_je_company on journal_entries(company_id);

create table journal_lines (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references journal_entries(id) on delete cascade,
  account_id  uuid not null references accounts(id),
  description text,
  debit       numeric(18,2) not null default 0,
  credit      numeric(18,2) not null default 0,
  created_at  timestamptz not null default now(),
  check (debit >= 0 and credit >= 0)
);
create index idx_jl_entry on journal_lines(entry_id);
create index idx_jl_account on journal_lines(account_id);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  payment_no    text not null,
  payment_type  payment_type not null default 'receipt',
  party_id      uuid references parties(id),
  invoice_id    uuid references invoices(id) on delete set null,
  payment_date  date not null default current_date,
  amount        numeric(18,2) not null,
  currency      char(3) not null references currencies(code) default 'PKR',
  fx_rate       numeric(18,6) not null default 1,
  account_id    uuid references accounts(id),
  memo          text,
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (company_id, payment_no)
);
create index idx_payments_company on payments(company_id);
create index idx_payments_invoice on payments(invoice_id);

create or replace function ensure_chart_of_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from accounts where company_id = p_company) then return; end if;
  insert into accounts(company_id, code, name, type, is_postable) values
    (p_company,'1000','Cash','asset',true),
    (p_company,'1010','Bank','asset',true),
    (p_company,'1100','Accounts Receivable','asset',true),
    (p_company,'1200','Supplier Advances','asset',true),
    (p_company,'2000','Accounts Payable','liability',true),
    (p_company,'2300','Tax Payable','liability',true),
    (p_company,'3000','Owner Equity','equity',true),
    (p_company,'3900','Retained Earnings','equity',true),
    (p_company,'4000','Sales - Umrah Services','income',true),
    (p_company,'4100','Other Income','income',true),
    (p_company,'5000','Cost of Services (Hotels/Visa/Transport/Air)','expense',true),
    (p_company,'6000','Salaries & Wages','expense',true),
    (p_company,'6100','Office & Admin','expense',true),
    (p_company,'6200','Bank Charges','expense',true);
end;
$$;

create or replace function acct(p_company uuid, p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from accounts where company_id = p_company and code = p_code;
$$;

create or replace function post_invoice_revenue(p_invoice uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv invoices%rowtype; v_company uuid; v_entry uuid; v_no text;
  v_base_subtotal numeric(18,2); v_base_tax numeric(18,2);
begin
  select * into inv from invoices where id = p_invoice;
  if not found then raise exception 'Invoice not found'; end if;
  v_company := inv.company_id;
  perform ensure_chart_of_accounts(v_company);
  if exists (select 1 from journal_entries where company_id = v_company and source = 'invoice' and reference = inv.invoice_no) then
    return null;
  end if;
  v_base_subtotal := round(inv.subtotal * inv.fx_rate, 2);
  v_base_tax := round(inv.tax_amount * inv.fx_rate, 2);
  v_no := next_doc_number(v_company, 'journal');
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference)
  values (v_company, v_no, inv.invoice_date, 'Sales invoice '||inv.invoice_no, 'posted', 'invoice', inv.invoice_no)
  returning id into v_entry;
  insert into journal_lines(entry_id, account_id, description, debit, credit) values
    (v_entry, acct(v_company,'1100'), 'AR - '||inv.invoice_no, v_base_subtotal + v_base_tax, 0),
    (v_entry, acct(v_company,'4000'), 'Sales - '||inv.invoice_no, 0, v_base_subtotal);
  if v_base_tax > 0 then
    insert into journal_lines(entry_id, account_id, description, debit, credit)
    values (v_entry, acct(v_company,'2300'), 'Tax - '||inv.invoice_no, 0, v_base_tax);
  end if;
  return v_entry;
end;
$$;

create or replace function record_receipt(
  p_company uuid, p_invoice uuid, p_amount numeric, p_account uuid, p_date date, p_memo text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv invoices%rowtype; v_pay_no text; v_je_no text; v_entry uuid; v_payment uuid;
  v_base numeric(18,2); v_new_paid numeric(18,2);
begin
  select * into inv from invoices where id = p_invoice and company_id = p_company;
  if not found then raise exception 'Invoice not found'; end if;
  perform ensure_chart_of_accounts(p_company);
  v_base := round(p_amount * inv.fx_rate, 2);
  v_pay_no := next_doc_number(p_company, 'receipt');
  v_je_no  := next_doc_number(p_company, 'journal');
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference)
  values (p_company, v_je_no, p_date, coalesce(p_memo,'Receipt for '||inv.invoice_no), 'posted', 'receipt', v_pay_no)
  returning id into v_entry;
  insert into journal_lines(entry_id, account_id, description, debit, credit) values
    (v_entry, coalesce(p_account, acct(p_company,'1010')), 'Receipt '||v_pay_no, v_base, 0),
    (v_entry, acct(p_company,'1100'), 'AR settle '||inv.invoice_no, 0, v_base);
  insert into payments(company_id, payment_no, payment_type, party_id, invoice_id, payment_date,
                       amount, currency, fx_rate, account_id, memo, journal_entry_id)
  values (p_company, v_pay_no, 'receipt', inv.customer_id, p_invoice, p_date,
          p_amount, inv.currency, inv.fx_rate, coalesce(p_account, acct(p_company,'1010')), p_memo, v_entry)
  returning id into v_payment;
  v_new_paid := inv.amount_paid + p_amount;
  update invoices
    set amount_paid = v_new_paid,
        status = case when v_new_paid >= total then 'paid'
                      when v_new_paid > 0 then 'partially_paid'
                      else status end
    where id = p_invoice;
  return v_payment;
end;
$$;

alter table accounts        enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines   enable row level security;
alter table payments        enable row level security;

create policy accounts_staff on accounts for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());
create policy je_staff on journal_entries for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());
create policy jl_staff on journal_lines for all to authenticated
  using (exists (select 1 from journal_entries e where e.id = entry_id and e.company_id = auth_company_id()) and is_staff())
  with check (exists (select 1 from journal_entries e where e.id = entry_id and e.company_id = auth_company_id()) and is_staff());
create policy payments_staff on payments for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

revoke all on function ensure_chart_of_accounts(uuid) from anon;
revoke all on function acct(uuid,text) from anon;
revoke all on function post_invoice_revenue(uuid) from anon;
revoke all on function record_receipt(uuid,uuid,numeric,uuid,date,text) from anon;
grant execute on function post_invoice_revenue(uuid) to authenticated;
grant execute on function record_receipt(uuid,uuid,numeric,uuid,date,text) to authenticated;
grant execute on function ensure_chart_of_accounts(uuid) to authenticated;

select ensure_chart_of_accounts('96f6b539-b491-4df7-91a2-80c7c8e7491d');
