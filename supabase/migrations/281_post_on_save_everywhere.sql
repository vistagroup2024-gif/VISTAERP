-- 281_post_on_save_everywhere.sql
-- One rule for every voucher: saving it posts it. If the voucher type carries
-- an authorisation rule, saving instead holds it for the approvers, and the
-- approval posts it — the maker never presses "post", and the approver never
-- has to either.
--
-- The accounting vouchers (Receipt, Payment, Journal, Contra, Petty Cash and
-- the bill-wise pair) already worked this way through gl_submit. These did not:
-- the trade documents posted only when someone pressed a button, and skipped
-- the authorisation rules altogether, so a Purchase Voucher of any size posted
-- unapproved. Payroll had the same hole.
--
-- gl_submit holds a set of GL LINES and replays them on approval. That cannot
-- work for a document whose posting has side effects — a Purchase Voucher also
-- receives stock, and its cost is only known at the moment the stock moves. So
-- these hold the DOCUMENT instead: nothing happens until approval, and the
-- approval runs the real posting routine then and there.

-- ---------------------------------------------------------------------------
-- Hold a document for its approvers. Returns the pending voucher's id.
-- ---------------------------------------------------------------------------
create or replace function acct_hold_document(
  p_company uuid, p_doc_type text, p_date date, p_memo text, p_reference text,
  p_amount numeric, p_needed int, p_post_fn text, p_doc_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_who text;
begin
  insert into pending_vouchers(company_id, doc_type, entry_date, narration, reference, amount,
                               lines, approvals_needed, created_by, payload)
  values (p_company, p_doc_type, coalesce(p_date, current_date), p_memo, p_reference, p_amount,
          '[]'::jsonb, p_needed, auth.uid(),
          jsonb_build_object('post_fn', p_post_fn, 'doc_id', p_doc_id))
  returning id into v_id;

  perform acct_log(p_company, 'submitted', p_doc_type, v_id::text,
    jsonb_build_object('amount', p_amount, 'approvals_needed', p_needed));
  select string_agg(coalesce(pr.full_name, pr.email, 'an approver'), ', ')
    into v_who from acct_voucher_approvers a join profiles pr on pr.id = a.user_id
    where a.company_id = p_company and a.doc_type = p_doc_type;
  perform push_notification('staff', null, 'accounting', 'Voucher awaiting authorisation',
    p_doc_type || ' for ' || p_amount || coalesce(' — for ' || v_who, '') || ' to authorise',
    'accounting', null, '/accounting/approvals');
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- The trade documents. trade_doc_post_now is the real work — stock and GL —
-- and trade_doc_post is the gate in front of it.
-- ---------------------------------------------------------------------------
alter function trade_doc_post(uuid) rename to trade_doc_post_now;
revoke all on function trade_doc_post_now(uuid) from public, authenticated;

create or replace function trade_doc_post(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d trade_documents; v_co uuid := auth_company_id(); v_needed int; v_id uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into d from trade_documents where id = p_id and company_id = v_co;
  if not found then raise exception 'Document not found'; end if;
  if d.gl_entry is not null then raise exception 'Already posted'; end if;
  if d.doc_type not in ('purchase_voucher','purchase_return','sales_return','sales_invoice') then
    raise exception 'This document type does not post to the GL';
  end if;
  if d.status = 'awaiting_approval' then
    raise exception 'This voucher is already awaiting authorisation.';
  end if;

  v_needed := acct_approvals_needed(v_co, d.doc_type, coalesce(d.total, 0));
  if v_needed >= 1 then
    v_id := acct_hold_document(v_co, d.doc_type, d.doc_date, coalesce(d.narration, d.doc_no),
                               d.doc_no, coalesce(d.total, 0), v_needed, 'trade_doc_post_now', p_id);
    update trade_documents set status = 'awaiting_approval' where id = p_id;
    -- 'pending_id', not 'id': this result is merged into trade_doc_save's,
    -- and an 'id' key here would overwrite the document's own id.
    return jsonb_build_object('pending', true, 'pending_id', v_id, 'amount', coalesce(d.total, 0));
  end if;

  return trade_doc_post_now(p_id) || jsonb_build_object('pending', false);
end $$;

-- Saving a voucher posts it. Nothing to press, and nothing left half-done.
create or replace function trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0;
        v_sub numeric(18,2) := 0; v_round numeric(18,2); v_src uuid; v_car uuid;
        v_status text; v_posted jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_round := round(coalesce((p_header->>'round_off')::numeric, 0), 2);
  v_src := nullif(p_header->>'source_doc_id','')::uuid;
  v_car := nullif(p_header->>'source_car_contract','')::uuid;
  select coalesce(sum(round(coalesce((x->>'amount')::numeric,0),2)), 0) into v_sub
    from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) x;

  if p_type = 'sales_invoice' and is_car_cost_center(p_header->>'cost_center') then
    raise exception 'A car sale is invoiced in Car Sales, not with a Sales Invoice.';
  end if;

  if v_id is not null then
    select status into v_status from trade_documents where id = v_id and company_id = v_co;
    if v_status = 'awaiting_approval' then
      raise exception 'This voucher is awaiting authorisation and cannot be changed.';
    end if;
  end if;

  if v_src is not null and exists (
      select 1 from trade_documents t
      where t.company_id = v_co and t.doc_type = p_type and t.source_doc_id = v_src
        and (v_id is null or t.id <> v_id)) then
    raise exception 'That document has already been loaded into another %.', p_type;
  end if;
  if v_car is not null and exists (
      select 1 from trade_documents t
      where t.company_id = v_co and t.doc_type = p_type and t.source_car_contract = v_car
        and (v_id is null or t.id <> v_id)) then
    raise exception 'That Car Invoice has already been loaded into another %.', p_type;
  end if;

  if v_id is null then
    insert into doc_sequences(company_id, doc_type, prefix)
      values (v_co, 'trade_'||p_type, coalesce(nullif(p_prefix,''), upper(left(p_type,3))||'-'))
      on conflict (company_id, doc_type) do nothing;
    v_no := next_doc_number(v_co, 'trade_'||p_type);
    insert into trade_documents(company_id, doc_type, doc_no, doc_date, party_id, cost_center, tag_area, reference,
      narration, terms, mode_of_payment, due_date, delivery_date, currency, round_off, subtotal, total, status, meta,
      source_doc_id, source_car_contract, created_by)
    values (v_co, p_type, v_no,
      coalesce(nullif(p_header->>'doc_date','')::date, current_date), nullif(p_header->>'party_id','')::uuid,
      nullif(p_header->>'cost_center',''), nullif(p_header->>'tag_area',''), nullif(p_header->>'reference',''),
      nullif(p_header->>'narration',''), nullif(p_header->>'terms',''), nullif(p_header->>'mode_of_payment',''),
      nullif(p_header->>'due_date','')::date, nullif(p_header->>'delivery_date','')::date,
      coalesce(nullif(p_header->>'currency',''),'SAR'), v_round, v_sub, v_sub + v_round,
      coalesce(nullif(p_header->>'status',''),'open'), coalesce(p_header->'meta','{}'::jsonb), v_src, v_car, auth.uid())
    returning id, doc_no into v_id, v_no;
  else
    update trade_documents set
      doc_date = coalesce(nullif(p_header->>'doc_date','')::date, current_date), party_id = nullif(p_header->>'party_id','')::uuid,
      cost_center = nullif(p_header->>'cost_center',''), tag_area = nullif(p_header->>'tag_area',''), reference = nullif(p_header->>'reference',''),
      narration = nullif(p_header->>'narration',''), terms = nullif(p_header->>'terms',''), mode_of_payment = nullif(p_header->>'mode_of_payment',''),
      due_date = nullif(p_header->>'due_date','')::date, delivery_date = nullif(p_header->>'delivery_date','')::date,
      currency = coalesce(nullif(p_header->>'currency',''),'SAR'), round_off = v_round, subtotal = v_sub, total = v_sub + v_round,
      meta = coalesce(p_header->'meta','{}'::jsonb),
      source_doc_id = coalesce(v_src, source_doc_id), source_car_contract = coalesce(v_car, source_car_contract),
      updated_at = now()
    where id = v_id and company_id = v_co;
    if not found then raise exception 'Document not found'; end if;
    select doc_no into v_no from trade_documents where id = v_id;
    delete from trade_document_lines where doc_id = v_id;
  end if;

  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    i := i + 1;
    if coalesce(nullif(ln->>'item_name',''), nullif(ln->>'product_id','')) is null and round(coalesce((ln->>'amount')::numeric,0),2) = 0 then continue; end if;
    insert into trade_document_lines(doc_id, sort, product_id, item_name, units, quantity, rate, amount, link1, meta)
    values (v_id, i, nullif(ln->>'product_id','')::uuid, nullif(ln->>'item_name',''), nullif(ln->>'units',''),
      round(coalesce((ln->>'quantity')::numeric,0),3), round(coalesce((ln->>'rate')::numeric,0),2),
      round(coalesce((ln->>'amount')::numeric,0),2), nullif(ln->>'link1',''), coalesce(ln->'meta','{}'::jsonb));
  end loop;

  -- The warehouse has to be on the document before the stock moves.
  if p_header ? 'warehouse_id' and nullif(p_header->>'warehouse_id','') is not null then
    update trade_documents set warehouse_id = (p_header->>'warehouse_id')::uuid where id = v_id;
  end if;

  -- Post it, or hand it to the approvers. Paperwork types (quotation, order,
  -- MRN, delivery note) have no GL side and simply save.
  if p_type in ('purchase_voucher','purchase_return','sales_return','sales_invoice') then
    v_posted := trade_doc_post(v_id);
  end if;

  return coalesce(v_posted, '{}'::jsonb) || jsonb_build_object('id', v_id, 'doc_no', v_no);
end $function$;

-- ---------------------------------------------------------------------------
-- Payroll had the same hole: the run posted straight to the GL.
-- ---------------------------------------------------------------------------
alter function payroll_post(uuid) rename to payroll_post_now;
revoke all on function payroll_post_now(uuid) from public, authenticated;

create or replace function payroll_post(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); r payroll_runs%rowtype; v_needed int; v_id uuid;
        v_amt numeric(18,2); v_label text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into r from payroll_runs where id = p_run and company_id = v_co;
  if not found then raise exception 'Run not found'; end if;
  if r.status = 'posted' then raise exception 'Already posted'; end if;
  if r.status = 'awaiting_approval' then raise exception 'This payroll run is already awaiting authorisation.'; end if;
  -- The gross is what the rule is measured against, the same figure the entry debits.
  select coalesce(sum(basic + allowances), 0) into v_amt from payslips where run_id = p_run;
  v_label := r.period_year || '-' || lpad(r.period_month::text, 2, '0');

  v_needed := acct_approvals_needed(v_co, 'gl_payroll', v_amt);
  if v_needed >= 1 then
    v_id := acct_hold_document(v_co, 'gl_payroll', make_date(r.period_year, r.period_month, 1),
                               'Payroll ' || v_label, 'PR-' || r.period_year || lpad(r.period_month::text, 2, '0'),
                               v_amt, v_needed, 'payroll_post_now', p_run);
    update payroll_runs set status = 'awaiting_approval' where id = p_run;
    return jsonb_build_object('pending', true, 'pending_id', v_id, 'amount', v_amt);
  end if;

  return payroll_post_now(p_run) || jsonb_build_object('pending', false);
end $$;

-- ---------------------------------------------------------------------------
-- Approval runs the held document's own posting routine, so the side effects
-- (stock, open items, the run's own bookkeeping) happen exactly once, at the
-- moment it is approved.
-- ---------------------------------------------------------------------------
create or replace function voucher_approve(p_pending uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pv pending_vouchers%rowtype; v_count int; v jsonb; v_lim numeric(18,2);
        v_fn text; v_doc uuid; v_entry uuid;
begin
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if not acct_can_authorize_type(pv.company_id, pv.doc_type) then
    raise exception 'You are not an approver for %', pv.doc_type;
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
      -- A held DOCUMENT: run its own posting routine now. The name is checked
      -- against a fixed list — it comes out of a jsonb column and goes into
      -- dynamic SQL, so it is never taken on trust.
      v_fn := pv.payload->>'post_fn';
      if v_fn not in ('trade_doc_post_now', 'payroll_post_now') then
        raise exception 'Unknown posting routine %', v_fn;
      end if;
      v_doc := (pv.payload->>'doc_id')::uuid;
      execute format('select %I($1)', v_fn) into v using v_doc;
      -- Those routines report the entry NUMBER; read the id off the document
      -- itself so the approval still links to the entry it produced.
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
end $$;

-- Rejecting a held document hands it back to the maker to correct.
create or replace function voucher_reject(p_pending uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pv pending_vouchers%rowtype; v_doc uuid;
begin
  if not acct_can_authorize() then raise exception 'You are not allowed to reject vouchers'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  select * into pv from pending_vouchers where id = p_pending and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if pv.status <> 'pending' then raise exception 'Voucher is already %', pv.status; end if;
  update pending_vouchers set status = 'rejected', reject_reason = p_reason where id = p_pending;
  insert into pending_voucher_approvals(pending_id, actor, action, note) values (p_pending, auth.uid(), 'reject', p_reason);

  if pv.payload ? 'post_fn' then
    v_doc := (pv.payload->>'doc_id')::uuid;
    if pv.payload->>'post_fn' = 'trade_doc_post_now' then
      update trade_documents set status = 'open' where id = v_doc and company_id = pv.company_id;
    elsif pv.payload->>'post_fn' = 'payroll_post_now' then
      update payroll_runs set status = 'draft' where id = v_doc and company_id = pv.company_id;
    end if;
  end if;

  perform acct_log(pv.company_id, 'rejected', pv.doc_type, p_pending::text, jsonb_build_object('reason', p_reason));
  perform push_notification('staff', null, 'accounting', 'Voucher rejected',
    pv.doc_type || ' rejected: ' || p_reason, 'accounting', null);
  return jsonb_build_object('rejected', true);
end $$;

-- A voucher waiting on its approvers is not ready to be carried forward.
create or replace function trade_doc_pending(p_target_type text)
returns jsonb language sql stable security definer set search_path = public as $$
  with docs as (
    select d.id, d.doc_no, d.doc_date,
           (select p.name from parties p where p.id = d.party_id) party_name,
           d.cost_center, d.reference, d.total,
           (select count(*) from trade_document_lines l where l.doc_id = d.id) lines,
           'trade' as source_kind
    from trade_documents d
    where d.company_id = auth_company_id()
      and d.doc_type = trade_doc_source_type(p_target_type)
      and coalesce(d.status, 'open') not in ('cancelled', 'closed', 'awaiting_approval')
      and not exists (
        select 1 from trade_documents t
        where t.company_id = d.company_id and t.doc_type = p_target_type and t.source_doc_id = d.id)
      and (p_target_type <> 'sales_invoice' or not is_car_cost_center(d.cost_center))
    union all
    select c.id, c.contract_no, c.contract_date,
           (select p.name from parties p where p.id = c.customer_id),
           'CAR SALES', null, c.sale_price, 1, 'car'
    from car_contracts c
    where p_target_type = 'delivery_note'
      and c.company_id = auth_company_id()
      and c.status in ('active', 'completed')
      and not exists (
        select 1 from trade_documents t
        where t.company_id = c.company_id and t.doc_type = 'delivery_note' and t.source_car_contract = c.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'doc_no', doc_no, 'doc_date', doc_date, 'party_name', party_name,
    'cost_center', cost_center, 'reference', reference, 'total', total,
    'lines', lines, 'source_kind', source_kind)
    order by doc_date desc, doc_no desc), '[]'::jsonb)
  from docs;
$$;

grant execute on function trade_doc_post(uuid) to authenticated;
grant execute on function payroll_post(uuid) to authenticated;
revoke all on function acct_hold_document(uuid, text, date, text, text, numeric, int, text, uuid) from public, authenticated;
