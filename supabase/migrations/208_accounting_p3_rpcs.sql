-- ============================================================
-- VISTA ERP — Accounting rebuild, PHASE 3 (RPCs)
-- Invoice/bill → open item (+ credit check), FIFO allocation of receipts/payments,
-- aging, outstanding list, PDC lifecycle. All GL via the single gl_post engine.
-- ============================================================

-- Number series for the new document types.
insert into doc_sequences(company_id, doc_type, prefix, next_number, padding)
select c.id, x.doc_type, x.prefix, 1, 1 from companies c
cross join (values ('gl_sales','Inv:'), ('gl_purchase','Bil:'), ('gl_pdc','Pdc:')) as x(doc_type, prefix)
on conflict (company_id, doc_type) do nothing;

-- Reduce a party account's open items FIFO by a settlement amount; returns the amount
-- actually allocated (leftover stays on-account).
create or replace function allocate_fifo(
  p_company uuid, p_account_id uuid, p_settle_entry uuid, p_amount numeric, p_note text default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare it record; remaining numeric(18,2) := round(p_amount,2); take numeric(18,2);
begin
  for it in select * from open_items
    where company_id = p_company and account_id = p_account_id and status = 'open' and outstanding_base > 0
    order by coalesce(due_date, doc_date), created_at
  loop
    exit when remaining <= 0;
    take := least(remaining, it.outstanding_base);
    insert into allocations(company_id, open_item_id, settle_entry_id, amount_base, note)
    values (p_company, it.id, p_settle_entry, take, p_note);
    update open_items set outstanding_base = outstanding_base - take,
      status = case when outstanding_base - take <= 0.005 then 'settled' else 'open' end
      where id = it.id;
    remaining := remaining - take;
  end loop;
  return round(p_amount,2) - remaining;
end $$;

-- Sales invoice (customer) or purchase bill (supplier). Posts the dual-sided GL entry
-- and records an open item on the party account. Enforces credit limit for customers.
create or replace function party_invoice(
  p_company uuid, p_party uuid, p_kind text, p_date date, p_due date, p_narration text,
  p_amount numeric, p_income_expense_account uuid, p_tax numeric, p_reference text,
  p_override_credit boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_tax_acc uuid; total numeric(18,2); v jsonb; lines jsonb; v_open uuid;
        v_limit numeric(18,2); v_out numeric(18,2); v_doc text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be positive'; end if;
  v_acc := ensure_party_account(p_company, p_party, p_kind);
  total := round(coalesce(p_amount,0),2) + round(coalesce(p_tax,0),2);
  select id into v_tax_acc from accounts where company_id = p_company and code = '2-02';

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
    if coalesce(p_tax,0) > 0 and v_tax_acc is not null then
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_tax_acc::text, 'debit', 0, 'credit', round(p_tax,2), 'description', 'VAT 15%'));
    end if;
  else
    v_doc := 'gl_purchase';
    lines := jsonb_build_array(
      jsonb_build_object('account_id', v_acc::text, 'debit', 0, 'credit', total, 'description', p_narration),
      jsonb_build_object('account_id', p_income_expense_account::text, 'debit', round(p_amount,2), 'credit', 0, 'description', p_narration));
    if coalesce(p_tax,0) > 0 and v_tax_acc is not null then
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_tax_acc::text, 'debit', round(p_tax,2), 'credit', 0, 'description', 'Input VAT 15%'));
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

-- Receive from a customer / pay a supplier, posting cash↔party and auto-allocating FIFO.
create or replace function party_settle(
  p_company uuid, p_kind text, p_date date, p_cash_bank uuid, p_party_account uuid,
  p_amount numeric, p_narration text, p_reference text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; lines jsonb; allocated numeric(18,2);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be positive'; end if;
  if p_kind = 'customer' then
    lines := jsonb_build_array(
      jsonb_build_object('account_id', p_cash_bank::text, 'debit', round(p_amount,2), 'credit', 0, 'description', p_narration),
      jsonb_build_object('account_id', p_party_account::text, 'debit', 0, 'credit', round(p_amount,2), 'description', p_narration));
    v := gl_post(p_company, p_date, p_narration, 'gl_receipt', 'receipt', p_reference, lines);
  else
    lines := jsonb_build_array(
      jsonb_build_object('account_id', p_party_account::text, 'debit', round(p_amount,2), 'credit', 0, 'description', p_narration),
      jsonb_build_object('account_id', p_cash_bank::text, 'debit', 0, 'credit', round(p_amount,2), 'description', p_narration));
    v := gl_post(p_company, p_date, p_narration, 'gl_payment', 'payment', p_reference, lines);
  end if;
  allocated := allocate_fifo(p_company, p_party_account, (v->>'entry_id')::uuid, p_amount, 'Auto FIFO');
  perform acct_log(p_company, 'posted', case when p_kind='customer' then 'gl_receipt' else 'gl_payment' end,
    v->>'entry_no', jsonb_build_object('amount', p_amount, 'allocated', allocated));
  return jsonb_build_object('entry_no', v->>'entry_no', 'allocated', allocated, 'on_account', round(p_amount,2) - allocated);
end $$;

-- Aging by party account (buckets as-of a date), for customers or suppliers.
create or replace function ar_ap_aging(p_company uuid, p_kind text, p_as_of date default current_date)
returns jsonb language sql stable security definer set search_path = public as $$
  with items as (
    select o.account_id, a.code, a.name, a.phone,
      o.outstanding_base ob, (p_as_of - coalesce(o.due_date, o.doc_date)) age
    from open_items o join accounts a on a.id = o.account_id
    where o.company_id = p_company and o.status = 'open'
      and o.direction = case when p_kind = 'supplier' then 'C' else 'D' end
  )
  select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb) from (
    select account_id, code, name, phone,
      sum(ob) total,
      sum(ob) filter (where age <= 30) b0,
      sum(ob) filter (where age between 31 and 60) b1,
      sum(ob) filter (where age between 61 and 90) b2,
      sum(ob) filter (where age between 91 and 180) b3,
      sum(ob) filter (where age > 180) b4
    from items group by account_id, code, name, phone
  ) t(account_id, code, name, phone, total, b0, b1, b2, b3, b4);
$$;

-- Open items (outstanding) for one party account.
create or replace function party_outstanding(p_company uuid, p_account_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'doc_no', doc_no, 'doc_date', doc_date, 'due_date', due_date,
    'amount', amount_base, 'outstanding', outstanding_base, 'status', status
  ) order by doc_date), '[]'::jsonb)
  from open_items where company_id = p_company and account_id = p_account_id and status = 'open';
$$;

-- ── PDC lifecycle ───────────────────────────────────────────
-- Create a PDC. received: Dr Cheque-in-Hand, Cr customer (allocates now, cheque is an
-- asset in hand). issued: no GL until it clears (cash only moves on clearance).
create or replace function pdc_create(
  p_company uuid, p_direction text, p_party_account uuid, p_bank_account uuid,
  p_cheque_no text, p_bank_name text, p_amount numeric, p_cheque_date date, p_narration text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb := null; v_chq uuid; v_id uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be positive'; end if;
  if p_direction = 'received' then
    select id into v_chq from accounts where company_id = p_company and code = '1-02-02';
    v := gl_post(p_company, current_date, coalesce(p_narration,'PDC received ')||coalesce(p_cheque_no,''), 'gl_pdc', 'pdc_in', p_cheque_no,
      jsonb_build_array(
        jsonb_build_object('account_id', v_chq::text, 'debit', round(p_amount,2), 'credit', 0, 'description', 'Cheque in hand'),
        jsonb_build_object('account_id', p_party_account::text, 'debit', 0, 'credit', round(p_amount,2), 'description', p_narration)));
    perform allocate_fifo(p_company, p_party_account, (v->>'entry_id')::uuid, p_amount, 'PDC');
  end if;
  insert into pdc_register(company_id, direction, party_account_id, bank_account_id, cheque_no, bank_name,
                           amount_base, cheque_date, narration, in_entry_id, created_by)
  values (p_company, p_direction, p_party_account, p_bank_account, p_cheque_no, p_bank_name,
          round(p_amount,2), p_cheque_date, p_narration, (v->>'entry_id')::uuid, auth.uid())
  returning id into v_id;
  perform acct_log(p_company, 'pdc_created', 'gl_pdc', p_cheque_no, jsonb_build_object('id', v_id, 'dir', p_direction));
  return jsonb_build_object('id', v_id);
end $$;

-- Move a PDC through its lifecycle. clear posts to bank; bounce reverses a received
-- cheque and reopens the settled invoices; cancel just closes an issued/void cheque.
create or replace function pdc_update(p_company uuid, p_pdc uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p pdc_register%rowtype; v jsonb; v_chq uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into p from pdc_register where id = p_pdc and company_id = p_company;
  if not found then raise exception 'PDC not found'; end if;
  select id into v_chq from accounts where company_id = p_company and code = '1-02-02';

  if p_status = 'deposited' then
    update pdc_register set status = 'deposited' where id = p_pdc;
  elsif p_status = 'cleared' then
    if p.direction = 'received' then
      v := gl_post(p_company, current_date, 'PDC cleared '||coalesce(p.cheque_no,''), 'gl_pdc', 'pdc_clear', p.cheque_no,
        jsonb_build_array(
          jsonb_build_object('account_id', p.bank_account_id::text, 'debit', p.amount_base, 'credit', 0, 'description', 'Cheque cleared'),
          jsonb_build_object('account_id', v_chq::text, 'debit', 0, 'credit', p.amount_base, 'description', 'Cheque in hand')));
    else
      -- issued: pay the supplier now (Dr supplier, Cr bank) and allocate.
      v := gl_post(p_company, current_date, 'PDC issued cleared '||coalesce(p.cheque_no,''), 'gl_pdc', 'pdc_clear', p.cheque_no,
        jsonb_build_array(
          jsonb_build_object('account_id', p.party_account_id::text, 'debit', p.amount_base, 'credit', 0, 'description', p.narration),
          jsonb_build_object('account_id', p.bank_account_id::text, 'debit', 0, 'credit', p.amount_base, 'description', 'Cheque paid')));
      perform allocate_fifo(p_company, p.party_account_id, (v->>'entry_id')::uuid, p.amount_base, 'PDC issued');
    end if;
    update pdc_register set status = 'cleared', clear_entry_id = (v->>'entry_id')::uuid where id = p_pdc;
  elsif p_status = 'bounced' then
    if p.direction = 'received' then
      -- reverse the receipt (Dr customer, Cr cheque-in-hand) and undo its allocations.
      v := gl_post(p_company, current_date, 'PDC bounced '||coalesce(p.cheque_no,''), 'gl_pdc', 'pdc_bounce', p.cheque_no,
        jsonb_build_array(
          jsonb_build_object('account_id', p.party_account_id::text, 'debit', p.amount_base, 'credit', 0, 'description', 'Cheque bounced'),
          jsonb_build_object('account_id', v_chq::text, 'debit', 0, 'credit', p.amount_base, 'description', 'Cheque in hand')));
      update open_items o set outstanding_base = outstanding_base + a.amt, status = 'open'
        from (select open_item_id, sum(amount_base) amt from allocations where settle_entry_id = p.in_entry_id group by open_item_id) a
        where o.id = a.open_item_id;
      delete from allocations where settle_entry_id = p.in_entry_id;
    end if;
    update pdc_register set status = 'bounced', clear_entry_id = (v->>'entry_id')::uuid where id = p_pdc;
  elsif p_status = 'cancelled' then
    update pdc_register set status = 'cancelled' where id = p_pdc;
  else
    raise exception 'Unknown PDC status %', p_status;
  end if;
  perform acct_log(p_company, 'pdc_'||p_status, 'gl_pdc', p.cheque_no, jsonb_build_object('id', p_pdc));
  return jsonb_build_object('status', p_status);
end $$;

grant execute on function allocate_fifo(uuid,uuid,uuid,numeric,text) to authenticated;
grant execute on function party_invoice(uuid,uuid,text,date,date,text,numeric,uuid,numeric,text,boolean) to authenticated;
grant execute on function party_settle(uuid,text,date,uuid,uuid,numeric,text,text) to authenticated;
grant execute on function ar_ap_aging(uuid,text,date) to authenticated;
grant execute on function party_outstanding(uuid,uuid) to authenticated;
grant execute on function pdc_create(uuid,text,uuid,uuid,text,text,numeric,date,text) to authenticated;
grant execute on function pdc_update(uuid,uuid,text) to authenticated;
