-- Unifies the "Advance against a Sale Order" branch of the Receipt Voucher's
-- car_receipt_save into a real Receipt Voucher: posted synchronously through
-- gl_submit under doc_type='gl_receipt' (same RCT- numbering, same approval
-- gate, same Document No./Previous/Next lookup as every other receipt),
-- instead of a separate car_receipt-sourced, RCP--numbered, automation-toggle
-- -gated posting that gl_voucher_find could never see. Modelled directly on
-- the existing po_payment_save / po_advances precedent (Payment-side advance
-- against a Purchase Order), which already solves this exact shape correctly.
--
-- The INSTALLMENT-COLLECTION branch of car_receipt_save (money collected
-- against an already-invoiced car contract, from ContractDetail's own
-- PaymentPanel) is deliberately UNCHANGED — still trigger-posted, still
-- source='car_receipt', still RCP- numbered. That is genuine per-installment
-- allocation a flat gl_submit line array cannot express, and is out of scope.
--
-- car_receipts.entry_id is new: a direct link from a car_receipts row to the
-- journal_entries row that actually posted it, so every lookup that used to
-- string-match on (source='car_receipt', reference=receipt_no) now works
-- uniformly for both the old trigger-posted rows and the new synchronously
-- -posted ones.
--
-- CRITICAL rehearsal finding: the car.receipt automation rule is currently
-- ON (fixed in a prior migration so installment collection keeps posting).
-- trg_car_autopost_receipt fires on every INSERT into car_receipts
-- regardless of source, so the new synchronous INSERT (already carrying its
-- real entry_id) was ALSO triggering car_post_receipt, which created a
-- SECOND, duplicate car_receipt-sourced journal entry for the same money and
-- clobbered the correct entry_id. car_post_receipt now no-ops
-- (idempotent, returns true) whenever entry_id is already set on the row —
-- this guard is required for correctness, not just tidiness.

alter table car_receipts add column if not exists entry_id uuid references journal_entries(id);

update car_receipts cr set entry_id = je.id
  from journal_entries je
 where cr.entry_id is null and je.company_id = cr.company_id
   and je.source = 'car_receipt' and je.reference = cr.receipt_no and je.status = 'posted';

drop function if exists public.car_receipt_save(uuid, jsonb, jsonb);

create function public.car_receipt_save(p_id uuid, p_header jsonb, p_allocs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_company uuid := auth_company_id(); v_id uuid; v_no text;
  v_contract uuid := nullif(p_header->>'contract_id','')::uuid;
  v_doc      uuid := nullif(p_header->>'source_doc_id','')::uuid;
  v_amount numeric := coalesce(nullif(p_header->>'amount','')::numeric, 0);
  v_alloc_total numeric; a jsonb; v_cust uuid; v_allocs jsonb; v_anchor uuid;
  v_cash uuid; v_cc text; v_ta text; v_so_no text; v_party uuid; v_method text; v_res jsonb; v_lines jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if v_contract is null and v_doc is null then
    raise exception 'Choose the Car Invoice, or the Sale Order this advance is against.';
  end if;
  if v_amount <= 0 then raise exception 'Enter a receipt amount'; end if;

  if v_contract is not null then
    -- UNCHANGED: installment collection against an already-invoiced contract.
    if p_id is not null then
      raise exception 'Editing a saved receipt is not supported — void it from the Receipt Voucher (or this contract''s Receipts list) and enter it again.';
    end if;
    select customer_id into v_cust from car_contracts where id = v_contract and company_id = v_company;
    if not found then raise exception 'Contract not found'; end if;
    v_allocs := coalesce(p_allocs, '[]'::jsonb);
    v_alloc_total := coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(v_allocs) e), 0);
    if round(v_alloc_total, 2) > round(v_amount, 2) then
      raise exception 'Allocated (%) exceeds the receipt amount (%).', round(v_alloc_total,2), round(v_amount,2);
    end if;
    v_no := next_doc_number(v_company, 'car_receipt');
    insert into car_receipts(company_id, receipt_no, contract_id, source_doc_id, customer_id, created_by)
    values (v_company, v_no, v_contract, null, v_cust, auth.uid()) returning id into v_id;
    update car_receipts set
      receipt_date  = coalesce(nullif(p_header->>'receipt_date','')::date, current_date),
      amount        = v_amount,
      method        = coalesce(nullif(p_header->>'method',''), 'cash'),
      cash_account_id = nullif(p_header->>'cash_account_id','')::uuid,
      reference     = nullif(p_header->>'reference',''),
      notes         = nullif(p_header->>'notes','')
    where id = v_id and company_id = v_company
    returning contract_id into v_anchor;
    for a in select * from jsonb_array_elements(v_allocs) loop
      if coalesce(nullif(a->>'amount','')::numeric,0) <> 0 then
        insert into car_receipt_allocations(receipt_id, target_type, installment_id, amount)
        values (v_id, coalesce(nullif(a->>'target_type',''),'installment'),
                nullif(a->>'installment_id','')::uuid, (a->>'amount')::numeric);
      end if;
    end loop;
    perform car_recompute_installments(v_anchor);
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (v_company, auth.uid(), 'car_receipt_created',
            'car_receipt', v_id, jsonb_build_object('amount', v_amount, 'allocated', v_alloc_total, 'against', 'car_invoice'));
    return jsonb_build_object('pending', false, 'id', v_id, 'receipt_no', v_no);
  end if;

  -- NEW: advance against a Sale Order, unified into a real Receipt Voucher.
  if p_id is not null then
    raise exception 'Editing a saved advance receipt is not supported here — open it from the Receipt Voucher screen (Document No.) to change or void it.';
  end if;
  select d.party_id, nullif(btrim(d.cost_center),''), nullif(btrim(d.tag_area),''), d.doc_no
    into v_cust, v_cc, v_ta, v_so_no
    from trade_documents d
   where d.id = v_doc and d.company_id = v_company and d.doc_type = 'sale_order'
     and is_car_cost_center(d.cost_center);
  if v_cust is null then
    raise exception 'That is not a car Sale Order, or it has no customer on it.';
  end if;
  if exists (select 1 from car_contracts c
              where c.company_id = v_company and c.source_doc_id = v_doc) then
    raise exception 'That Sale Order is already invoiced - take the receipt against the Car Invoice.';
  end if;
  v_cash := nullif(p_header->>'cash_account_id','')::uuid;
  if v_cash is null then raise exception 'Choose the cash / bank account the money went into.'; end if;
  perform car_ensure_accounts(v_company);
  v_party := coalesce(car_party_account(v_cust), acct(v_company, '1150'));
  select case when a.subtype = 'Cash' then 'cash' else 'bank' end into v_method
    from accounts a where a.id = v_cash;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_cash::text, 'debit', v_amount, 'credit', 0,
                        'description', p_header->>'notes', 'cost_center', v_cc, 'tag_area', v_ta),
    jsonb_build_object('account_id', v_party::text, 'debit', 0, 'credit', v_amount,
                        'description', p_header->>'notes', 'cost_center', v_cc, 'tag_area', v_ta));
  v_res := gl_submit(v_company,
    coalesce(nullif(p_header->>'receipt_date','')::date, current_date),
    coalesce(nullif(p_header->>'notes',''), 'Advance receipt against Sale Order ' || v_so_no),
    'gl_receipt', nullif(p_header->>'reference',''), v_lines,
    jsonb_build_object('car_advance_doc_id', v_doc::text, 'car_advance_amount', v_amount::text,
                        'car_advance_cash', v_cash::text));
  if coalesce((v_res->>'pending')::boolean, false) then
    return jsonb_build_object('pending', true, 'id', null, 'amount', v_amount);
  end if;
  insert into car_receipts(company_id, receipt_no, source_doc_id, customer_id, receipt_date, amount,
                            method, cash_account_id, reference, notes, created_by, entry_id)
  values (v_company, v_res->>'entry_no', v_doc, v_cust,
          coalesce(nullif(p_header->>'receipt_date','')::date, current_date), v_amount,
          coalesce(v_method, 'cash'), v_cash, nullif(p_header->>'reference',''), nullif(p_header->>'notes',''),
          auth.uid(), (v_res->>'entry_id')::uuid)
  returning id into v_id;
  insert into car_receipt_allocations(receipt_id, target_type, amount) values (v_id, 'advance', v_amount);
  perform car_recompute_installments(null);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_receipt_created', 'car_receipt', v_id,
          jsonb_build_object('amount', v_amount, 'allocated', v_amount, 'against', 'sale_order'));
  return jsonb_build_object('pending', false, 'id', v_id, 'entry_no', v_res->>'entry_no');
end $function$;

create or replace function public.voucher_approve(p_pending uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pv pending_vouchers%rowtype; v_count int; v jsonb; v_lim numeric(18,2);
        v_fn text; v_doc uuid; v_entry uuid;
begin
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if not acct_can_authorize_pending(p_pending) then
    raise exception 'You are not an approver for this voucher';
  end if;
  if pv.status <> 'pending' then raise exception 'Voucher is already %', pv.status; end if;
  if pv.created_by = auth.uid() and not is_admin() then
    raise exception 'You cannot authorise your own voucher (maker-checker)';
  end if;
  if not is_admin() then
    select acct_authorize_limit into v_lim from profiles where id = auth.uid();
    if v_lim is not null and pv.amount > v_lim then
      raise exception 'Amount % exceeds your authorisation limit of %', pv.amount, v_lim;
    end if;
  end if;

  insert into pending_voucher_approvals(pending_id, actor, action) values (p_pending, auth.uid(), 'approve')
    on conflict (pending_id, actor, action) do nothing;
  select count(*) into v_count from pending_voucher_approvals where pending_id = p_pending and action = 'approve';

  if v_count >= pv.approvals_needed then
    if pv.payload ? 'post_fn' then
      v_fn := pv.payload->>'post_fn';
      if v_fn not in ('trade_doc_post_now', 'payroll_post_now') then
        raise exception 'Unknown posting routine %', v_fn;
      end if;
      v_doc := (pv.payload->>'doc_id')::uuid;
      execute format('select %I($1)', v_fn) into v using v_doc;
      if v_fn = 'trade_doc_post_now' then
        select gl_entry into v_entry from trade_documents where id = v_doc;
      else
        select gl_entry into v_entry from payroll_runs where id = v_doc;
      end if;
    else
      v := gl_post(pv.company_id, pv.entry_date, pv.narration, pv.doc_type, 'approved', pv.reference, pv.lines);
      if pv.payload ? 'lines' then
        perform apply_billwise_allocations(pv.company_id, (v->>'entry_id')::uuid, pv.payload->'lines');
      end if;
      v_entry := (v->>'entry_id')::uuid;
      -- A Payment held for approval because it named a Purchase Order: the
      -- entry exists now, so the advance can finally be recorded against it.
      if pv.payload ? 'po_id' then
        insert into po_advances(company_id, source_doc_id, entry_id, supplier_id, amount, created_by)
        select pv.company_id, (pv.payload->>'po_id')::uuid, v_entry, d.party_id,
               coalesce((pv.payload->>'po_amount')::numeric, pv.amount), pv.created_by
        from trade_documents d where d.id = (pv.payload->>'po_id')::uuid;
      end if;
      -- A Receipt held for approval because it named a car advance Sale
      -- Order: the entry exists now, so the car_receipts row (for
      -- findability/allocation) is written the same as the synchronous path.
      if pv.payload ? 'car_advance_doc_id' then
        declare
          v_customer uuid; v_method text; v_cash uuid := (pv.payload->>'car_advance_cash')::uuid; v_rid uuid;
          v_amt numeric := coalesce((pv.payload->>'car_advance_amount')::numeric, pv.amount);
        begin
          select party_id into v_customer from trade_documents where id = (pv.payload->>'car_advance_doc_id')::uuid;
          select case when a.subtype = 'Cash' then 'cash' else 'bank' end into v_method from accounts a where a.id = v_cash;
          insert into car_receipts(company_id, receipt_no, source_doc_id, customer_id, receipt_date, amount,
                                    method, cash_account_id, reference, notes, created_by, entry_id)
          values (pv.company_id, v->>'entry_no', (pv.payload->>'car_advance_doc_id')::uuid, v_customer, pv.entry_date,
                  v_amt, coalesce(v_method,'cash'), v_cash, pv.reference, pv.narration, pv.created_by, v_entry)
          returning id into v_rid;
          insert into car_receipt_allocations(receipt_id, target_type, amount) values (v_rid, 'advance', v_amt);
        end;
      end if;
    end if;

    update pending_vouchers set status = 'authorized', posted_entry_id = v_entry where id = p_pending;
    perform acct_log(pv.company_id, 'authorized', pv.doc_type, v->>'entry_no', jsonb_build_object('pending_id', p_pending));
    perform push_notification('staff', null, 'accounting', 'Voucher authorised & posted',
      pv.doc_type || ' ' || coalesce(v->>'entry_no', '') || ' posted', 'accounting', null, null);
    return jsonb_build_object('posted', true, 'entry_no', v->>'entry_no');
  end if;
  perform acct_log(pv.company_id, 'approval', pv.doc_type, p_pending::text,
    jsonb_build_object('count', v_count, 'needed', pv.approvals_needed));
  return jsonb_build_object('posted', false, 'remaining', pv.approvals_needed - v_count);
end $function$;

create or replace function public.car_receipt_settle_bills(p_receipt uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r car_receipts; c car_contracts; v_entry uuid; v_acct uuid; a record; it record;
        v_item uuid; v_left numeric(18,2); v_take numeric(18,2);
begin
  select * into r from car_receipts where id = p_receipt;
  if not found or r.contract_id is null or coalesce(r.amount, 0) <= 0 then return; end if;
  if r.entry_id is not null then
    select id into v_entry from journal_entries where id = r.entry_id and status = 'posted';
  else
    select id into v_entry from journal_entries
     where company_id = r.company_id and source = 'car_receipt' and reference = r.receipt_no and status = 'posted';
  end if;
  if v_entry is null then return; end if;
  if exists (select 1 from allocations where settle_entry_id = v_entry) then return; end if;
  select * into c from car_contracts where id = r.contract_id;
  select jl.account_id into v_acct from journal_lines jl join accounts x on x.id = jl.account_id
   where jl.entry_id = v_entry and jl.credit > 0 and x.subtype = 'Receivable' limit 1;
  if v_acct is null then return; end if;
  v_left := r.amount;
  for a in select al.target_type, al.amount, i.inst_no
             from car_receipt_allocations al left join car_installments i on i.id = al.installment_id
            where al.receipt_id = r.id and al.amount > 0 loop
    exit when v_left <= 0;
    select id into v_item from open_items
     where account_id = v_acct and status = 'open' and outstanding_base > 0
       and doc_no = case when a.target_type = 'advance' then c.contract_no || ' advance'
                         else c.contract_no || '/' || a.inst_no end;
    if v_item is null then continue; end if;
    v_take := open_item_settle(v_item, v_entry, least(a.amount, v_left), 'Car Receipt ' || r.receipt_no);
    v_left := v_left - v_take;
  end loop;
  for it in select id from open_items
             where account_id = v_acct and status = 'open' and outstanding_base > 0
               and (doc_no = c.contract_no || ' advance' or doc_no like c.contract_no || '/%')
             order by due_date, doc_no loop
    exit when v_left <= 0;
    v_take := open_item_settle(it.id, v_entry, v_left, 'Car Receipt ' || r.receipt_no);
    v_left := v_left - v_take;
  end loop;
end $function$;

create or replace function public.car_post_receipt(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r car_receipts; cc text; ta text; v_cust uuid; v_cash uuid; v_ok boolean; v_entry uuid;
begin
  select * into r from car_receipts where id = p_id;
  if not found then return false; end if;
  -- Already posted (the synchronous gl_receipt advance path sets entry_id
  -- in the same INSERT this AFTER INSERT trigger fires from) — nothing to
  -- do, and re-posting here would double-post the same money under a
  -- second, car_receipt-sourced journal entry.
  if r.entry_id is not null then return true; end if;
  if coalesce(r.amount, 0) <= 0 then return false; end if;
  perform car_ensure_accounts(r.company_id);
  if r.contract_id is not null then
    select coalesce(nullif(btrim(cost_center),''), car_cost_center(vehicle_id)),
           coalesce(nullif(btrim(tag_area),''), car_tag_area(vehicle_id))
      into cc, ta from car_contracts where id = r.contract_id;
  else
    select nullif(btrim(d.cost_center),''), nullif(btrim(d.tag_area),'')
      into cc, ta from trade_documents d where d.id = r.source_doc_id;
  end if;
  v_cust := coalesce(car_party_account(r.customer_id), acct(r.company_id, '1150'));
  v_cash := coalesce(r.cash_account_id,
                     acct(r.company_id, case when r.method = 'cash' then '1000' else '1010' end));
  v_ok := car_post_entry(r.company_id, r.receipt_date,
    case when r.contract_id is null then 'Advance receipt ' else 'Installment receipt ' end || r.receipt_no,
    'car_receipt', r.receipt_no,
    jsonb_build_array(jsonb_build_object('account_id', v_cash, 'debit', r.amount,
                                         'cost_center', cc, 'tag_area', ta),
                      jsonb_build_object('account_id', v_cust, 'credit', r.amount,
                                         'cost_center', cc, 'tag_area', ta)));
  if v_ok then
    select id into v_entry from journal_entries
     where company_id = r.company_id and source = 'car_receipt' and reference = r.receipt_no and status = 'posted'
     order by created_at desc limit 1;
    if v_entry is not null then
      update car_receipts set entry_id = v_entry where id = p_id;
    end if;
  end if;
  perform car_receipt_settle_bills(p_id);
  return v_ok;
end $function$;

create or replace function public.journal_entry_release_open_items_for(p_entry uuid, p_entry_no text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_settled text;
begin
  update open_items oi
     set outstanding_base = oi.outstanding_base + s.amt, status = 'open'
    from (select open_item_id, sum(amount_base) as amt from allocations where settle_entry_id = p_entry group by 1) s
   where s.open_item_id = oi.id;
  delete from allocations where settle_entry_id = p_entry;
  -- A car receipt is re-settled by the module when the invoice re-posts, so
  -- its allocations against this entry's bills simply go with the bills.
  -- Covers both the old trigger-posted rows (source='car_receipt') and the
  -- new synchronously-posted ones, linked via car_receipts.entry_id.
  delete from allocations a
   using open_items oi, journal_entries se
   where oi.id = a.open_item_id and oi.entry_id = p_entry
     and se.id = a.settle_entry_id
     and (se.source = 'car_receipt' or exists (select 1 from car_receipts cr where cr.entry_id = se.id));
  -- A bill a typed receipt has settled against cannot go.
  select string_agg(distinct e.entry_no, ', ') into v_settled
    from allocations a join open_items oi on oi.id = a.open_item_id join journal_entries e on e.id = a.settle_entry_id
   where oi.entry_id = p_entry;
  if v_settled is not null then
    raise exception '% has been adjusted against by % — reverse that first, then this can be changed.', p_entry_no, v_settled;
  end if;
  delete from open_items where entry_id = p_entry;
end $function$;

create or replace function public.car_receipt_delete(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_company uuid := auth_company_id(); v_contract uuid; v_no text; v_entry uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select contract_id, receipt_no, entry_id into v_contract, v_no, v_entry
    from car_receipts where id = p_id and company_id = v_company;
  if not found then raise exception 'Receipt not found'; end if;
  delete from car_receipts where id = p_id and company_id = v_company;
  if v_entry is not null then
    delete from journal_lines where entry_id = v_entry;
    delete from journal_entries where id = v_entry and company_id = v_company;
  else
    delete from journal_lines where entry_id in (
      select id from journal_entries where company_id = v_company and source = 'car_receipt' and reference = v_no);
    delete from journal_entries
     where company_id = v_company and source = 'car_receipt' and reference = v_no;
  end if;
  perform car_recompute_installments(v_contract);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_receipt_deleted', 'car_receipt', p_id,
          jsonb_build_object('receipt_no', v_no));
end $function$;

revoke all on function public.car_receipt_save(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.car_receipt_save(uuid, jsonb, jsonb) to authenticated;
