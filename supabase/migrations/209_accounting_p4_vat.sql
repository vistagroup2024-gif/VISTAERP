-- ============================================================
-- VISTA ERP — Accounting rebuild, PHASE 4 (part 1): VAT
-- Split input VAT (recoverable) from output VAT (payable) so the VAT return
-- reconciles to the GL, and add the VAT report RPC.
-- ============================================================

-- Input VAT (recoverable) account, sibling of Output VAT (2-02).
select acct_seed_node('96f6b539-b491-4df7-91a2-80c7c8e7491d','2-03','INPUT VAT (Recoverable)','asset','2',false,'Tax');
select acct_rebuild_paths('96f6b539-b491-4df7-91a2-80c7c8e7491d');

-- Purchase bills post input VAT to 2-03 (was 2-02). Redefine party_invoice.
create or replace function party_invoice(
  p_company uuid, p_party uuid, p_kind text, p_date date, p_due date, p_narration text,
  p_amount numeric, p_income_expense_account uuid, p_tax numeric, p_reference text,
  p_override_credit boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_out_vat uuid; v_in_vat uuid; total numeric(18,2); v jsonb; lines jsonb; v_open uuid;
        v_limit numeric(18,2); v_out numeric(18,2); v_doc text;
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
      jsonb_build_object('account_id', p_income_expense_account::text, 'debit', 0, 'credit', round(p_amount,2), 'description', p_narration));
    if coalesce(p_tax,0) > 0 and v_out_vat is not null then
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_out_vat::text, 'debit', 0, 'credit', round(p_tax,2), 'description', 'Output VAT 15%'));
    end if;
  else
    v_doc := 'gl_purchase';
    lines := jsonb_build_array(
      jsonb_build_object('account_id', v_acc::text, 'debit', 0, 'credit', total, 'description', p_narration),
      jsonb_build_object('account_id', p_income_expense_account::text, 'debit', round(p_amount,2), 'credit', 0, 'description', p_narration));
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
  return jsonb_build_object('entry_no', v->>'entry_no', 'account_id', v_acc, 'open_item_id', v_open, 'total', total);
end $$;

-- VAT return figures for a period, straight from the GL tax accounts (ZATCA-style summary).
create or replace function vat_report(p_company uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  with mv as (
    select a.code, sum(l.debit) d, sum(l.credit) c
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join accounts a on a.id = l.account_id
    where e.company_id = p_company and e.status = 'posted'
      and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
      and a.code in ('2-02','2-03')
    group by a.code
  ),
  sales as (
    select coalesce(sum(l.credit - l.debit),0) base
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where e.company_id = p_company and e.status = 'posted' and a.type = 'income'
      and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
  ),
  purch as (
    select coalesce(sum(l.debit - l.credit),0) base
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where e.company_id = p_company and e.status = 'posted' and a.type = 'expense'
      and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
  )
  select jsonb_build_object(
    'output_vat', coalesce((select c - d from mv where code = '2-02'), 0),
    'input_vat',  coalesce((select d - c from mv where code = '2-03'), 0),
    'net_vat',    coalesce((select c - d from mv where code = '2-02'), 0) - coalesce((select d - c from mv where code = '2-03'), 0),
    'taxable_sales', (select base from sales),
    'taxable_purchases', (select base from purch)
  );
$$;

grant execute on function vat_report(uuid,date,date) to authenticated;
