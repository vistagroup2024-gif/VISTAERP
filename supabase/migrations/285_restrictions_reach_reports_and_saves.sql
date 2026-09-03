-- 285 Restrictions reach the reports and the save path.
--
-- 282 enforced the Restrict lists with row-level security on the four master
-- tables, which covers pickers, lists and voucher lines read through the tables
-- themselves. Two ways round it were left:
--
--   READING. 23 reports are security definer, so RLS never reaches them. A user
--   restricted to a few products still saw every item in Stock Ledger, Stock
--   Valuation, Ageing, ABC, Reorder and the rest; one restricted to a few
--   accounts still saw all of them in Aging, VAT Return, the account tree and
--   the dashboard. (acct_ledger and trial_balance already asked for the scope.)
--
--   WRITING. RLS filters what a picker offers, but the RPC behind a screen will
--   accept any id the caller sends it. Nothing checked that a hand-typed
--   voucher's lines stayed inside the user's accounts, or a trade document's
--   lines inside their items.
--
-- Note what is NOT covered, so it is not mistaken for working: cost centre and
-- tag area are stored on vouchers as TEXT, not as a reference, so those two
-- restrictions are enforced where they are chosen (the pickers, via RLS) and
-- cannot be re-checked on save the way accounts and items are.

-- Restrictions have to hold on the way IN as well as the way out. RLS filters
-- the pickers, but the RPC behind a screen will accept any id a caller sends,
-- so the hand-typed voucher gates check the lines themselves.
create or replace function public.staff_require_scope_accounts(p_lines jsonb)
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare v_bad text;
begin
  if staff_scope_ids('account') is null then return; end if;   -- unrestricted
  select string_agg(distinct coalesce(a.code || ' ' || a.name, x.id::text), ', ')
    into v_bad
  from (select nullif(l->>'account_id','')::uuid as id
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l) x
  left join accounts a on a.id = x.id
  where x.id is not null and not (x.id = any(staff_scope_ids('account')));
  if v_bad is not null then
    raise exception 'These accounts are outside the ones you are allowed to use: %', v_bad;
  end if;
end $$;

create or replace function public.staff_require_scope_products(p_lines jsonb)
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare v_bad text;
begin
  if staff_scope_ids('product') is null then return; end if;
  select string_agg(distinct coalesce(p.name, x.id::text), ', ')
    into v_bad
  from (select nullif(l->>'product_id','')::uuid as id
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l) x
  left join acct_products p on p.id = x.id
  where x.id is not null and not (x.id = any(staff_scope_ids('product')));
  if v_bad is not null then
    raise exception 'These items are outside the ones you are allowed to use: %', v_bad;
  end if;
end $$;

-- ── the hand-typed voucher gate checks its own lines ───────────────────────
-- gl_submit is the one door Receipt, Payment, Contra, Petty Cash, Journal and
-- the recurring generator all go through. gl_post stays open underneath it:
-- that is the engine the Visa, Hotel, Transport and Car modules post through.
create or replace function gl_submit(
  p_company uuid, p_date date, p_memo text, p_doc_type text, p_reference text, p_lines jsonb,
  p_payload jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_amount numeric(18,2); v_needed int; v_id uuid; v jsonb; v_who text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_scope_accounts(p_lines);
  v_amount := gl_validate(p_company, p_lines);
  v_needed := acct_approvals_needed(p_company, p_doc_type, v_amount);

  if v_needed >= 1 then
    insert into pending_vouchers(company_id, doc_type, entry_date, narration, reference, amount, lines,
                                 approvals_needed, created_by, payload)
    values (p_company, p_doc_type, p_date, p_memo, p_reference, v_amount, p_lines, v_needed, auth.uid(), p_payload)
    returning id into v_id;
    perform acct_log(p_company, 'submitted', p_doc_type, v_id::text,
      jsonb_build_object('amount', v_amount, 'approvals_needed', v_needed));
    -- Name the people who can act on it, so the alert is addressed rather than generic.
    select string_agg(coalesce(pr.full_name, pr.email, 'an approver'), ', ')
      into v_who from acct_voucher_approvers a join profiles pr on pr.id = a.user_id
      where a.company_id = p_company and a.doc_type = p_doc_type;
    perform push_notification('staff', null, 'accounting', 'Voucher awaiting authorisation',
      p_doc_type || ' for ' || v_amount || coalesce(' — for ' || v_who, '') || ' to authorise',
      'accounting', null, '/accounting/approvals');
    return jsonb_build_object('pending', true, 'id', v_id, 'amount', v_amount, 'approvers', v_who);
  end if;

  v := gl_post(p_company, p_date, p_memo, p_doc_type, p_doc_type, p_reference, p_lines);
  if p_payload ? 'lines' then
    perform apply_billwise_allocations(p_company, (v->>'entry_id')::uuid, p_payload->'lines');
  end if;
  perform acct_log(p_company, 'posted', p_doc_type, v->>'entry_no', jsonb_build_object('amount', v_amount));
  return jsonb_build_object('pending', false, 'entry_no', v->>'entry_no', 'entry_id', v->>'entry_id');
end $$;

-- ── trade documents check their item lines ─────────────────────────────────
create or replace function trade_doc_save(p_type text, p_prefix text, p_id uuid, p_header jsonb, p_lines jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text; ln jsonb; i int := 0;
        v_sub numeric(18,2) := 0; v_round numeric(18,2); v_src uuid; v_car uuid;
        v_status text; v_posted jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  -- Access tab: Create for a new document, Edit for an existing one, plus the
  -- two rights that decide whether somebody else's or an authorised document
  -- may be touched at all.
  if p_id is null then
    perform staff_require_doc(p_type, 'create');
  else
    perform staff_require_trade_right(p_id, 'edit');
  end if;
  perform staff_require_scope_products(p_lines);
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

-- ── the reports honour the restriction by running as the caller ─────────────
-- These 23 are read-only and every table they touch already carries a staff
-- policy, so dropping security definer lets row-level security do the filtering
-- instead of each report having to remember to ask. That covers accounts,
-- products, cost centres and tag areas at once, and covers any report added
-- later without further thought.
--
-- Deliberately NOT flipped, because a restriction must not reach them:
--   pending_inbox   an approver has to see every voucher waiting on them,
--                   including ones touching accounts they cannot otherwise open
--   trade_doc_load  loading a Sale Order into an invoice must copy ALL its
--                   lines; silently dropping one would corrupt the document
--   every engine    gl_post, gl_validate, party_invoice, trade_doc_post_now,
--                   the ensure_*_account helpers, visa/hotel/car posting — the
--                   modules call them on a user's behalf and a restriction on
--                   the user must not stop the company's books being written
alter function public.acct_dashboard(p_company uuid) security invoker;
alter function public.acct_tree(p_company uuid) security invoker;
alter function public.ar_ap_aging(p_company uuid, p_kind text, p_as_of date) security invoker;
alter function public.car_stock_summary() security invoker;
alter function public.report_cost_center_targets(p_from date, p_to date) security invoker;
alter function public.report_expense_budget(p_year integer) security invoker;
alter function public.stock_abc_analysis(p_from date, p_to date, p_wh uuid) security invoker;
alter function public.stock_ageing_analysis(p_as_of date, p_wh uuid, p_items uuid[]) security invoker;
alter function public.stock_balance_report() security invoker;
alter function public.stock_indent_list(p_from date, p_to date) security invoker;
alter function public.stock_item_query(p_item uuid) security invoker;
alter function public.stock_item_tree() security invoker;
alter function public.stock_ledger_report(p_from date, p_to date, p_items uuid[], p_wh uuid, p_moved_only boolean) security invoker;
alter function public.stock_movement_multilevel(p_from date, p_to date, p_items uuid[], p_wh uuid, p_moved_only boolean) security invoker;
alter function public.stock_movement_report(p_from date, p_to date, p_items uuid[], p_wh uuid) security invoker;
alter function public.stock_moving_items(p_from date, p_to date, p_mode text, p_limit integer, p_wh uuid) security invoker;
alter function public.stock_opening_register(p_as_of date, p_items uuid[], p_wh uuid) security invoker;
alter function public.stock_peak_low_balances(p_from date, p_to date, p_items uuid[], p_wh uuid) security invoker;
alter function public.stock_reorder_report(p_wh uuid) security invoker;
alter function public.stock_statement(p_from date, p_to date, p_items uuid[], p_wh uuid, p_moved_only boolean) security invoker;
alter function public.stock_valuation_report(p_as_of date, p_wh uuid, p_items uuid[]) security invoker;
alter function public.stock_virtual_analysis(p_wh uuid, p_items uuid[]) security invoker;
alter function public.vat_report(p_company uuid, p_from date, p_to date) security invoker;
