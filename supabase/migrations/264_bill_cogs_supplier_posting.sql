-- 264_bill_cogs_supplier_posting.sql
-- Supplier bills are now a BRN-only, fully automatic record:
--
--  * add_brn already creates the bill and calls post_bill_expense, so nothing is
--    posted by hand any more. What changes here is WHERE it posts. It used to
--    debit the legacy 'Cost of Services' (5000) and credit the single AP control
--    account (2000), so no balance ever landed on the supplier's own ledger.
--    It now debits COGS and credits the supplier's party account, which is what
--    makes the supplier's ledger — and the Payment Voucher's bill-wise
--    settlement — show the amount owed.
--  * The COGS account is resolved with acct_ensure_named, so it is created under
--    the expense root the first time it is needed if the chart doesn't have it.
--  * Hotel no longer uses supplier bills at all: the hotel invoice
--    (hotel_purchase_post_gl) already credits the supplier, and posting a payable
--    as well double-counted it. hotel_purchase_post_payable is kept as a stub so
--    a stale browser tab gets a clear message instead of silently creating a
--    duplicate payable.

create or replace function post_bill_expense(p_bill uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b bills%rowtype; v_company uuid; v_entry uuid; v_no text;
  v_base_subtotal numeric(18,2); v_base_tax numeric(18,2); v_cogs uuid; v_supplier uuid;
begin
  select * into b from bills where id = p_bill;
  if not found then raise exception 'Bill not found'; end if;
  v_company := b.company_id;
  perform ensure_chart_of_accounts(v_company);

  if exists (select 1 from journal_entries where company_id = v_company and source = 'bill' and reference = b.bill_no) then
    return null;  -- already posted
  end if;

  v_base_subtotal := round(b.subtotal * b.fx_rate, 2);
  v_base_tax := round(b.tax_amount * b.fx_rate, 2);

  -- Debit: COGS (created in the chart if it isn't there yet). An expense account
  -- explicitly set on the bill still wins.
  v_cogs := coalesce(b.expense_account_id,
                     acct_ensure_named(v_company, 'Cost of Goods Sold', 'expense', '5', 'COGS'));
  if v_cogs is null then
    raise exception 'No COGS account could be resolved or created for this company.';
  end if;

  -- Credit: the supplier's own ledger, not the pooled AP control account.
  if b.supplier_id is null then raise exception 'The bill has no supplier to credit.'; end if;
  v_supplier := ensure_party_account(v_company, b.supplier_id, 'supplier');
  if v_supplier is null then raise exception 'No ledger could be resolved for this supplier.'; end if;

  v_no := next_doc_number(v_company, 'journal');
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference)
  values (v_company, v_no, b.bill_date, 'Supplier bill '||b.bill_no, 'posted', 'bill', b.bill_no)
  returning id into v_entry;

  insert into journal_lines(entry_id, account_id, description, debit, credit) values
    (v_entry, v_cogs,     'Cost - '||b.bill_no,     v_base_subtotal, 0),
    (v_entry, v_supplier, 'Supplier - '||b.bill_no, 0, v_base_subtotal + v_base_tax);
  if v_base_tax > 0 then
    insert into journal_lines(entry_id, account_id, description, debit, credit)
    values (v_entry, acct(v_company,'2300'), 'Input tax - '||b.bill_no, v_base_tax, 0);
  end if;

  return v_entry;
end $$;

-- Hotel purchases are credited to the supplier by the hotel invoice; a supplier
-- bill on top would double-count the payable.
create or replace function hotel_purchase_post_payable(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Hotel purchases no longer use supplier bills — the hotel invoice already credits the supplier.';
end $$;
