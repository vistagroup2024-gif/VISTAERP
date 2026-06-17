-- ============================================================
-- VISTA ERP - 008 Purchase / Accounts Payable
-- Supplier bills + supplier payments, posted to the GL.
-- (Mirrors the migration applied via Supabase MCP.)
-- ============================================================

create type bill_status as enum ('draft','issued','partially_paid','paid','void');

create table bills (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  bill_no       text not null,
  supplier_id   uuid not null references parties(id),
  booking_id    uuid references bookings(id) on delete set null,
  bill_date     date not null default current_date,
  due_date      date,
  currency      char(3) not null references currencies(code) default 'SAR',
  fx_rate       numeric(18,6) not null default 1,
  subtotal      numeric(18,2) not null default 0,
  tax_amount    numeric(18,2) not null default 0,
  total         numeric(18,2) not null default 0,
  amount_paid   numeric(18,2) not null default 0,
  status        bill_status not null default 'issued',
  expense_account_id uuid references accounts(id),
  notes         text,
  created_at    timestamptz not null default now(),
  unique (company_id, bill_no)
);
create index idx_bills_company on bills(company_id);
create index idx_bills_supplier on bills(supplier_id);
create index idx_bills_booking on bills(booking_id);

create table bill_lines (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references bills(id) on delete cascade,
  description text not null,
  qty         numeric(12,2) not null default 1,
  unit_price  numeric(18,2) not null default 0,
  line_total  numeric(18,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index idx_bill_lines_bill on bill_lines(bill_id);

alter table payments add column if not exists bill_id uuid references bills(id) on delete set null;
create index if not exists idx_payments_bill on payments(bill_id);

-- Functions post_bill_expense() and record_bill_payment() and RLS policies:
-- see the applied migration 008 in Supabase for the full bodies.

create or replace function post_bill_expense(p_bill uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b bills%rowtype; v_company uuid; v_entry uuid; v_no text;
  v_base_subtotal numeric(18,2); v_base_tax numeric(18,2); v_exp uuid;
begin
  select * into b from bills where id = p_bill;
  if not found then raise exception 'Bill not found'; end if;
  v_company := b.company_id;
  perform ensure_chart_of_accounts(v_company);
  if exists (select 1 from journal_entries where company_id = v_company and source = 'bill' and reference = b.bill_no) then
    return null;
  end if;
  v_base_subtotal := round(b.subtotal * b.fx_rate, 2);
  v_base_tax := round(b.tax_amount * b.fx_rate, 2);
  v_exp := coalesce(b.expense_account_id, acct(v_company,'5000'));
  v_no := next_doc_number(v_company, 'journal');
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference)
  values (v_company, v_no, b.bill_date, 'Supplier bill '||b.bill_no, 'posted', 'bill', b.bill_no)
  returning id into v_entry;
  insert into journal_lines(entry_id, account_id, description, debit, credit) values
    (v_entry, v_exp, 'Cost - '||b.bill_no, v_base_subtotal, 0),
    (v_entry, acct(v_company,'2000'), 'AP - '||b.bill_no, 0, v_base_subtotal + v_base_tax);
  if v_base_tax > 0 then
    insert into journal_lines(entry_id, account_id, description, debit, credit)
    values (v_entry, acct(v_company,'2300'), 'Input tax - '||b.bill_no, v_base_tax, 0);
  end if;
  return v_entry;
end;
$$;

create or replace function record_bill_payment(
  p_company uuid, p_bill uuid, p_amount numeric, p_account uuid, p_date date, p_memo text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  b bills%rowtype; v_pay_no text; v_je_no text; v_entry uuid; v_payment uuid;
  v_base numeric(18,2); v_new_paid numeric(18,2);
begin
  select * into b from bills where id = p_bill and company_id = p_company;
  if not found then raise exception 'Bill not found'; end if;
  perform ensure_chart_of_accounts(p_company);
  v_base := round(p_amount * b.fx_rate, 2);
  v_pay_no := next_doc_number(p_company, 'billpay');
  v_je_no  := next_doc_number(p_company, 'journal');
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference)
  values (p_company, v_je_no, p_date, coalesce(p_memo,'Payment for '||b.bill_no), 'posted', 'billpay', v_pay_no)
  returning id into v_entry;
  insert into journal_lines(entry_id, account_id, description, debit, credit) values
    (v_entry, acct(p_company,'2000'), 'AP settle '||b.bill_no, v_base, 0),
    (v_entry, coalesce(p_account, acct(p_company,'1010')), 'Payment '||v_pay_no, 0, v_base);
  insert into payments(company_id, payment_no, payment_type, party_id, bill_id, payment_date,
                       amount, currency, fx_rate, account_id, memo, journal_entry_id)
  values (p_company, v_pay_no, 'payment', b.supplier_id, p_bill, p_date,
          p_amount, b.currency, b.fx_rate, coalesce(p_account, acct(p_company,'1010')), p_memo, v_entry)
  returning id into v_payment;
  v_new_paid := b.amount_paid + p_amount;
  update bills set amount_paid = v_new_paid,
    status = case when v_new_paid >= total then 'paid'
                  when v_new_paid > 0 then 'partially_paid' else status end
    where id = p_bill;
  return v_payment;
end;
$$;

alter table bills      enable row level security;
alter table bill_lines enable row level security;
create policy bills_staff on bills for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());
create policy bill_lines_staff on bill_lines for all to authenticated
  using (exists (select 1 from bills b where b.id = bill_id and b.company_id = auth_company_id()) and is_staff())
  with check (exists (select 1 from bills b where b.id = bill_id and b.company_id = auth_company_id()) and is_staff());
revoke all on function post_bill_expense(uuid) from anon;
revoke all on function record_bill_payment(uuid,uuid,numeric,uuid,date,text) from anon;
grant execute on function post_bill_expense(uuid) to authenticated;
grant execute on function record_bill_payment(uuid,uuid,numeric,uuid,date,text) to authenticated;
