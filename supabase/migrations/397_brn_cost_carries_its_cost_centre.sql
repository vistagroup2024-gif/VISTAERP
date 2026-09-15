-- 397 — post_bill_expense (the routine add_brn calls for every BRN bill; per
-- 264's own comment "Supplier bills are now a BRN-only, fully automatic
-- record") posted its COGS leg with no cost_center at all — the one field
-- every other cost posting in the ERP carries (trade_doc_post_now's service
-- invoices, car_post_entry). The account itself was already right (COGS
-- subtype, resolved via acct_ensure_named or an explicit expense_account_id);
-- what was missing was the dimension that lets a cost-centre P&L find it.
-- Since every bill this function posts is a BRN, the cost centre is fixed —
-- Umrah Visa, the same one visa.group_created already defaults to.

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

  insert into journal_lines(entry_id, account_id, description, debit, credit, cost_center) values
    (v_entry, v_cogs,     'Cost - '||b.bill_no,     v_base_subtotal, 0, 'UMRAH VISA'),
    (v_entry, v_supplier, 'Supplier - '||b.bill_no, 0, v_base_subtotal + v_base_tax, null);
  if v_base_tax > 0 then
    insert into journal_lines(entry_id, account_id, description, debit, credit)
    values (v_entry, acct(v_company,'2300'), 'Input tax - '||b.bill_no, v_base_tax, 0);
  end if;

  return v_entry;
end $$;

do $chk$
declare v_def text;
begin
  select pg_get_functiondef('public.post_bill_expense(uuid)'::regprocedure) into v_def;
  if v_def not like '%''UMRAH VISA''%' then
    raise exception 'post_bill_expense does not carry the UMRAH VISA cost centre';
  end if;
end $chk$;
