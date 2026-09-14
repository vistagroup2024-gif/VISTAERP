-- ============================================================
-- 387 — A car sale is billed by instalment, a cost is not an expense, and
--        the sale card reads every sale
--
-- 1. THE BILLS. One bill of 123,000 due on the first instalment's date was
--    wrong twice over: the popup offered the whole invoice as due on 01-09,
--    and the ageing report put the whole 123,000 in 0–30 when only 8,583 of
--    it was due. A car sale is now billed the way it is owed: the advance
--    (what the schedule does not carry) due on the invoice's advance date,
--    and one bill per instalment — CI-000005 advance, CI-000005/1 … /12 —
--    each due on its own date. A month of charges is due on the FIRST OF THE
--    NEXT MONTH, not the last of its own. car_contract_bills_raise is the one
--    routine, used by the posting and by the backfill.
--
--    A Car Receipt (RCP-) settles those bills through the allocations it
--    already carries — an instalment picked on the receipt settles that
--    instalment's bill, an advance the advance bill, and anything unnamed
--    goes FIFO over that contract's bills (car_receipt_settle_bills). It runs
--    when the receipt posts, when an invoice adopts the advance receipts of
--    its order, and when a contract re-posts. Because a contract re-posts on
--    every edit, the release routine lets a car receipt's allocations go
--    silently (they are re-settled on the re-post) and only refuses for a
--    receipt typed by hand, which nothing can re-settle.
--
-- 2. THE AGEING REPORT. It ages by due date and, with instalments as bills,
--    most of a car sale is not yet due. That is its own bucket now (not_due)
--    rather than 0–30, which is what the reader was told it was.
--
-- 3. COST OF SALES. The P&L and the Expenses card read every expense-type
--    account as an expense, so the cost of the cars sold (5100, 70,000) sat
--    under Expenses. The subtype 'COGS' — already on the account editor —
--    is what says an account is cost of sales: the P&L shows Cost of Sales
--    and a Gross Profit before Expenses, and the Expenses card leaves it
--    out. 5000 and 5100 were raised by the ERP with no subtype; they are
--    COGS now, and so are the leaves the user filed under their own
--    "COGS EXPENSE" group. Any other account is the user's to classify.
--
-- 4. THE SALE CARD. Purchase vs Sale counted Sales Invoices only, so a month
--    with a 123,000 car sale read Sale 0. It counts every posted sale
--    document now — Sales Invoice, the four service invoices and the Car
--    Invoice — and its margin is sale less cost of sales off the ledger.
--
-- 5. car_post_entry declared a loop variable `l` in 385 beside the `l` alias
--    of its jsonb_array_elements — plpgsql only notices at run time, so every
--    car posting since 385 would have failed with "column reference l is
--    ambiguous". The 387 rehearsal is what caught it; the variable is `ln`.
--
-- 6. A cash or bank voucher can be in a foreign currency: the editor posts
--    base amounts and stamps the currency and rate on the entry through
--    gl_voucher_stamp_fx, the way the Journal already records its own.
-- ============================================================
begin;

-- ── one bill per (entry, account, direction, doc_no) ───────────────────────
create or replace function public.open_item_raise(
  p_company uuid, p_entry uuid, p_account uuid, p_direction text, p_doc_type text, p_doc_no text,
  p_doc_date date, p_due date, p_amount numeric)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_party uuid; v_date date; v_due date; v_days int;
begin
  if p_account is null or round(coalesce(p_amount, 0), 2) <= 0 then return null; end if;
  select a.party_id, coalesce(nullif(p.credit_days, 0), a.credit_days, 0)
    into v_party, v_days
    from accounts a left join parties p on p.id = a.party_id where a.id = p_account;
  v_date := coalesce(p_doc_date, current_date);
  v_due := coalesce(p_due, v_date + coalesce(v_days, 0));
  select id into v_id from open_items
   where entry_id = p_entry and account_id = p_account and direction = p_direction and doc_no is not distinct from p_doc_no;
  if v_id is not null then return v_id; end if;
  insert into open_items(company_id, account_id, party_id, direction, doc_type, doc_no, doc_date, due_date,
                         currency, amount_base, outstanding_base, entry_id, status)
  values (p_company, p_account, v_party, p_direction, p_doc_type, p_doc_no, v_date, v_due,
          'SAR', round(p_amount, 2), round(p_amount, 2), p_entry, 'open')
  returning id into v_id;
  return v_id;
end $function$;
revoke all on function public.open_item_raise(uuid, uuid, uuid, text, text, text, date, date, numeric) from public, anon, authenticated;

-- ── settling one bill, as one routine ──────────────────────────────────────
create or replace function public.open_item_settle(p_item uuid, p_settle_entry uuid, p_amount numeric, p_note text)
returns numeric
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_take numeric(18,2); v_co uuid;
begin
  select least(round(p_amount, 2), outstanding_base), company_id into v_take, v_co
    from open_items where id = p_item and status = 'open' and outstanding_base > 0;
  if v_take is null or v_take <= 0 then return 0; end if;
  insert into allocations(company_id, open_item_id, settle_entry_id, amount_base, note)
  values (v_co, p_item, p_settle_entry, v_take, p_note);
  update open_items set outstanding_base = outstanding_base - v_take,
         status = case when outstanding_base - v_take <= 0.005 then 'settled' else 'open' end
   where id = p_item;
  return v_take;
end $function$;
revoke all on function public.open_item_settle(uuid, uuid, numeric, text) from public, anon, authenticated;

-- ── a car receipt settles the bills its allocations name ───────────────────
create or replace function public.car_receipt_settle_bills(p_receipt uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare r car_receipts; c car_contracts; v_entry uuid; v_acct uuid; a record; it record;
        v_item uuid; v_left numeric(18,2); v_take numeric(18,2);
begin
  select * into r from car_receipts where id = p_receipt;
  if not found or r.contract_id is null or coalesce(r.amount, 0) <= 0 then return; end if;
  select id into v_entry from journal_entries
   where company_id = r.company_id and source = 'car_receipt' and reference = r.receipt_no and status = 'posted';
  if v_entry is null then return; end if;
  if exists (select 1 from allocations where settle_entry_id = v_entry) then return; end if;
  select * into c from car_contracts where id = r.contract_id;
  select jl.account_id into v_acct from journal_lines jl join accounts x on x.id = jl.account_id
   where jl.entry_id = v_entry and jl.credit > 0 and x.subtype = 'Receivable' limit 1;
  if v_acct is null then return; end if;
  v_left := r.amount;
  -- What the receipt names: this instalment, or the advance.
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
  -- The rest, oldest first, over this contract's bills.
  for it in select id from open_items
             where account_id = v_acct and status = 'open' and outstanding_base > 0
               and (doc_no = c.contract_no || ' advance' or doc_no like c.contract_no || '/%')
             order by due_date, doc_no loop
    exit when v_left <= 0;
    v_take := open_item_settle(it.id, v_entry, v_left, 'Car Receipt ' || r.receipt_no);
    v_left := v_left - v_take;
  end loop;
end $function$;
revoke all on function public.car_receipt_settle_bills(uuid) from public, anon, authenticated;

-- ── the car sale's bills: the advance, then one per instalment ─────────────
create or replace function public.car_contract_bills_raise(p_entry uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare e journal_entries; c car_contracts; l record; i record; rc record;
        v_n int; v_sum numeric(18,2); v_adv numeric(18,2); v_no text;
begin
  select * into e from journal_entries where id = p_entry and source = 'car_sale';
  if not found then return; end if;
  select * into c from car_contracts where company_id = e.company_id and contract_no = e.reference;
  v_no := coalesce(c.contract_no, e.entry_no);
  for l in select jl.account_id, jl.debit from journal_lines jl join accounts a on a.id = jl.account_id
            where jl.entry_id = e.id and jl.debit > 0 and a.subtype = 'Receivable' loop
    select count(*), coalesce(sum(amount), 0) into v_n, v_sum from car_installments where contract_id = c.id;
    if c.id is null or v_n = 0 or v_sum > l.debit + 0.005 then
      -- No schedule to bill by: the whole sale, due on the invoice date.
      perform open_item_raise(e.company_id, e.id, l.account_id, 'D', 'car_sale', v_no, e.entry_date,
                              coalesce(c.contract_date, e.entry_date), l.debit);
      continue;
    end if;
    -- What the schedule does not carry is due up front: the advance.
    v_adv := round(l.debit - v_sum, 2);
    if v_adv > 0 then
      perform open_item_raise(e.company_id, e.id, l.account_id, 'D', 'car_sale', v_no || ' advance', e.entry_date,
                              coalesce(c.advance_due_date, c.contract_date, e.entry_date), v_adv);
    end if;
    for i in select inst_no, due_date, amount from car_installments where contract_id = c.id order by inst_no loop
      perform open_item_raise(e.company_id, e.id, l.account_id, 'D', 'car_installment', v_no || '/' || i.inst_no,
                              e.entry_date, i.due_date, i.amount);
    end loop;
  end loop;
  -- The receipts this contract already holds settle against the new bills.
  if c.id is not null then
    for rc in select id from car_receipts where contract_id = c.id order by receipt_date, receipt_no loop
      perform car_receipt_settle_bills(rc.id);
    end loop;
  end if;
end $function$;
revoke all on function public.car_contract_bills_raise(uuid) from public, anon, authenticated;

-- ── the postings ───────────────────────────────────────────────────────────
create or replace function public.car_post_entry(p_company uuid, p_date date, p_memo text, p_source text, p_reference text, p_lines jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_entry uuid; v_no text; v_one boolean; ln record; v_due date;
begin
  if exists (select 1 from journal_entries where company_id = p_company and source = p_source and reference = p_reference) then
    return false;
  end if;
  v_one := coalesce((select value = 'true' from erp_settings where key = 'ledger_uses_doc_no'), false);
  if p_source = 'car_scharge_month' then
    v_no := next_doc_number(p_company, 'car_scharge_month');
  elsif v_one and p_reference ~ '^[A-Z]{2,5}-[0-9]+$'
        and not exists (select 1 from journal_entries where company_id = p_company and entry_no = p_reference) then
    v_no := p_reference;
  else
    v_no := next_doc_number(p_company, 'journal');
  end if;
  insert into journal_entries(company_id, entry_no, entry_date, memo, status, source, reference, created_by)
  values (p_company, v_no, coalesce(p_date, current_date), p_memo, 'posted', p_source, p_reference, auth.uid())
  returning id into v_entry;
  insert into journal_lines(entry_id, account_id, description, debit, credit, cost_center, tag_area)
  select v_entry,
         coalesce(nullif(l->>'account_id','')::uuid, acct(p_company, l->>'code')),
         p_memo,
         round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
         nullif(btrim(coalesce(l->>'cost_center','')), ''),
         nullif(btrim(coalesce(l->>'tag_area','')), '')
  from jsonb_array_elements(p_lines) l
  where coalesce((l->>'debit')::numeric, 0) <> 0 or coalesce((l->>'credit')::numeric, 0) <> 0;
  -- The bills. A car sale by its schedule; a month of charges due on the
  -- first of the next month, one per customer debited.
  if p_source = 'car_sale' then
    perform car_contract_bills_raise(v_entry);
  elsif p_source = 'car_scharge_month' then
    v_due := (date_trunc('month', coalesce(p_date, current_date)) + interval '1 month')::date;
    for ln in select jl.account_id, jl.debit from journal_lines jl join accounts a on a.id = jl.account_id
              where jl.entry_id = v_entry and jl.debit > 0 and a.subtype = 'Receivable' loop
      perform open_item_raise(p_company, v_entry, ln.account_id, 'D', p_source, v_no, coalesce(p_date, current_date), v_due, ln.debit);
    end loop;
  end if;
  return true;
end $function$;

create or replace function public.car_post_receipt(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare r car_receipts; cc text; ta text; v_cust uuid; v_cash uuid; v_ok boolean;
begin
  select * into r from car_receipts where id = p_id;
  if not found then return false; end if;
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
  -- The money settles the bills it was paid for.
  perform car_receipt_settle_bills(p_id);
  return v_ok;
end $fn$;

-- The invoice adopts the order's advance receipts, and they settle its bills.
create or replace function public.car_contract_link_source(p_contract uuid, p_doc uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_co uuid := auth_company_id(); n int; rc record;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_doc is null then return; end if;
  if not exists (select 1 from trade_documents d
                 where d.id = p_doc and d.company_id = v_co and d.doc_type = 'sale_order') then
    raise exception 'Sale Order not found';
  end if;
  if exists (select 1 from car_contracts c
             where c.company_id = v_co and c.source_doc_id = p_doc and c.id <> p_contract) then
    raise exception 'That Sale Order has already been invoiced.';
  end if;
  update car_contracts set source_doc_id = p_doc where id = p_contract and company_id = v_co;
  if not found then raise exception 'Car Invoice not found'; end if;
  update car_receipts set contract_id = p_contract
   where company_id = v_co and source_doc_id = p_doc and contract_id is null;
  get diagnostics n = row_count;
  if n > 0 then
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (v_co, auth.uid(), 'car_advance_receipts_adopted', 'car_contract', p_contract,
            jsonb_build_object('sale_order', p_doc, 'receipts', n));
    for rc in select id from car_receipts where contract_id = p_contract order by receipt_date, receipt_no loop
      perform car_receipt_settle_bills(rc.id);
    end loop;
  end if;
end $fn$;

-- ── a car receipt's allocations go with a re-posted invoice ────────────────
create or replace function public.journal_entry_release_open_items_for(p_entry uuid, p_entry_no text)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_settled text;
begin
  update open_items oi
     set outstanding_base = oi.outstanding_base + s.amt, status = 'open'
    from (select open_item_id, sum(amount_base) as amt from allocations where settle_entry_id = p_entry group by 1) s
   where s.open_item_id = oi.id;
  delete from allocations where settle_entry_id = p_entry;
  -- A car receipt is re-settled by the module when the invoice re-posts, so
  -- its allocations against this entry's bills simply go with the bills.
  delete from allocations a
   using open_items oi, journal_entries se
   where oi.id = a.open_item_id and oi.entry_id = p_entry
     and se.id = a.settle_entry_id and se.source = 'car_receipt';
  -- A bill a typed receipt has settled against cannot go.
  select string_agg(distinct e.entry_no, ', ') into v_settled
    from allocations a join open_items oi on oi.id = a.open_item_id join journal_entries e on e.id = a.settle_entry_id
   where oi.entry_id = p_entry;
  if v_settled is not null then
    raise exception '% has been adjusted against by % — reverse that first, then this can be changed.', p_entry_no, v_settled;
  end if;
  delete from open_items where entry_id = p_entry;
end $function$;
revoke all on function public.journal_entry_release_open_items_for(uuid, text) from public, anon, authenticated;

-- ── the ageing report has a "not yet due" bucket ───────────────────────────
create or replace function public.ar_ap_aging(p_company uuid, p_kind text, p_as_of date default current_date)
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
      sum(ob) filter (where age < 0) not_due,
      sum(ob) filter (where age between 0 and 30) b0,
      sum(ob) filter (where age between 31 and 60) b1,
      sum(ob) filter (where age between 61 and 90) b2,
      sum(ob) filter (where age between 91 and 180) b3,
      sum(ob) filter (where age > 180) b4
    from items group by account_id, code, name, phone
  ) t(account_id, code, name, phone, total, not_due, b0, b1, b2, b3, b4);
$$;

-- ── cost of sales is not an expense ────────────────────────────────────────
update accounts set subtype = 'COGS'
 where company_id in (select id from companies) and type::text = 'expense' and subtype is null
   and code in ('5000', '5100');
update accounts a set subtype = 'COGS'
  from accounts g
 where g.id = a.parent_id and g.is_group and upper(g.name) like 'COGS%' and a.type::text = 'expense' and not a.is_group;

create or replace function public.trial_balance(p_company uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  with posted as (
    select l.account_id, l.debit, l.credit, e.entry_date
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    where e.company_id = p_company and e.status = 'posted'
  ),
  agg as (
    select a.id, a.code, a.name, a.type as nature, a.subtype,
      coalesce(sum(x.debit - x.credit) filter (where p_from is not null and x.entry_date < p_from), 0) as opening_net,
      coalesce(sum(x.debit)  filter (where (p_from is null or x.entry_date >= p_from) and (p_to is null or x.entry_date <= p_to)), 0) as period_debit,
      coalesce(sum(x.credit) filter (where (p_from is null or x.entry_date >= p_from) and (p_to is null or x.entry_date <= p_to)), 0) as period_credit
    from accounts a
    left join posted x on x.account_id = a.id
    where a.company_id = p_company and a.is_postable
      and (staff_scope_ids('account') is null or a.id = any(staff_scope_ids('account')))
    group by a.id, a.code, a.name, a.type, a.subtype
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'code', code, 'name', name, 'nature', nature, 'subtype', subtype,
    'opening_debit',  case when opening_net > 0 then opening_net else 0 end,
    'opening_credit', case when opening_net < 0 then -opening_net else 0 end,
    'period_debit', period_debit, 'period_credit', period_credit,
    'closing_net', opening_net + period_debit - period_credit
  ) order by code), '[]'::jsonb)
  from agg
  where opening_net <> 0 or period_debit <> 0 or period_credit <> 0;
$function$;

-- ── the dashboard: expenses without cost of sales, and every sale counted ───
create or replace function public.dashboard_metrics()
returns jsonb language sql stable security invoker set search_path to 'public' as $function$
with
  co as (select auth_company_id() as id),
  bounds as (
    select date_trunc('month', current_date)::date as month_start,
           date_trunc('year',  current_date)::date as year_start,
           current_date as today
  ),
  gl as (
    select l.debit, l.credit, e.entry_date, a.type::text as acct_type, a.subtype
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join accounts a on a.id = l.account_id
    where e.status = 'posted' and e.company_id = (select id from co)
  ),
  open_ar_ap as (
    -- Receivable and Payable come off the LEDGER, not off open_items.
    select
      (select coalesce(sum(g.debit - g.credit), 0) from gl g where g.subtype = 'Receivable') as ar,
      (select coalesce(sum(g.credit - g.debit), 0) from gl g where g.subtype = 'Payable') as ap,
      coalesce(sum(o.outstanding_base) filter (where o.direction = 'D' and o.due_date < current_date), 0) as ar_overdue,
      coalesce(sum(o.outstanding_base) filter (where o.direction = 'C' and o.due_date < current_date), 0) as ap_overdue
    from open_items o
    where o.status = 'open' and o.company_id = (select id from co)
  ),
  td as (
    select d.*,
           (exists (select 1 from trade_documents x where x.source_doc_id = d.id)
            or exists (select 1 from car_contracts cc where cc.source_doc_id = d.id)) as consumed
    from trade_documents d where d.company_id = (select id from co)
  ),
  -- Every sale the business made, whatever voucher made it: a Sales Invoice,
  -- a service invoice, or a Car Invoice (which is not a trade document).
  sales_docs as (
    select doc_date, total from td
     where doc_type in ('sales_invoice','air_ticket_invoice','visa_invoice','transport_invoice','hotel_invoice')
       and gl_entry is not null
    union all
    select contract_date, net_payable from car_contracts
     where company_id = (select id from co) and status in ('active','completed')
  ),
  so_pending as (
    select
      coalesce(sum(x.total), 0) as order_value,
      coalesce(sum(x.adv), 0)   as advance,
      coalesce(sum(x.rcv), 0)   as received
    from (
      select coalesce(d.total, 0) as total,
             case when d.meta->>'advance' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                  then (d.meta->>'advance')::numeric else 0 end as adv,
             coalesce((select sum(r.amount) from car_receipts r where r.source_doc_id = d.id), 0) as rcv
        from td d
       where d.doc_type = 'sale_order' and not d.consumed) x
  ),
  stock as (
    select coalesce(sum(b.qty), 0) as qty,
           coalesce(sum(b.value), 0) as value,
           count(distinct b.item_id) filter (where b.qty > 0) as items
    from stock_balances b where b.company_id = (select id from co)
  ),
  so_qty as (
    select coalesce(sum(l.quantity), 0) as q from trade_document_lines l
    join td on td.id = l.doc_id where td.doc_type = 'sale_order' and not td.consumed
  ),
  po_qty as (
    select coalesce(sum(l.quantity), 0) as q from trade_document_lines l
    join td on td.id = l.doc_id where td.doc_type = 'purchase_order' and not td.consumed
  ),
  cars as (
    select
      count(*) filter (where status = 'in_stock')  as in_stock,
      count(*) filter (where status = 'reserved')  as reserved,
      count(*) filter (where status = 'sold')      as sold,
      count(*) filter (where status = 'delivered') as delivered,
      count(*) filter (where status = 'held')      as held,
      count(*) as total
    from car_vehicles where company_id = (select id from co)
  ),
  car_due_items as (
    select i.due_date as due,
           greatest(i.amount - i.paid_amount, 0) as amt,
           coalesce(i.paid_amount, 0) as paid
      from car_installments i
      join car_contracts c on c.id = i.contract_id
     where c.company_id = (select id from co)
    union all
    select coalesce(c.advance_due_date, c.contract_date),
           greatest(coalesce(c.advance, 0) - coalesce(adv.paid, 0), 0),
           coalesce(adv.paid, 0)
      from car_contracts c
      left join lateral (
        select coalesce(sum(al.amount), 0) as paid
          from car_receipt_allocations al
          join car_receipts r on r.id = al.receipt_id
         where r.contract_id = c.id and al.target_type = 'advance') adv on true
     where c.company_id = (select id from co) and coalesce(c.advance, 0) > 0
    union all
    select s.due_date,
           greatest(s.amount - s.paid_amount, 0),
           coalesce(s.paid_amount, 0)
      from car_service_charges s
     where s.company_id = (select id from co)
  ),
  car_money as (
    select
      (select coalesce(sum(net_payable), 0) from car_contracts
        where company_id = (select id from co)) as sale_value,
      (select coalesce(sum(advance), 0) from car_contracts
        where company_id = (select id from co)) as advance,
      (select coalesce(sum(x.bal), 0) from (
         select a.id, coalesce(sum(l.debit - l.credit), 0) as bal
           from accounts a
           join journal_lines l on l.account_id = a.id
           join journal_entries e on e.id = l.entry_id and e.status = 'posted'
          where a.company_id = (select id from co)
            and a.party_id in (select customer_id from car_contracts
                                where company_id = (select id from co) and customer_id is not null)
          group by a.id) x) as balance,
      coalesce(sum(v.amt) filter (where v.due < (select month_start from bounds)), 0) as overdue,
      coalesce(sum(v.amt) filter (where v.due >= (select month_start from bounds)
                                    and v.due <= (select today from bounds)), 0) as due_this_month,
      coalesce(sum(v.paid), 0) as collected
    from car_due_items v
  ),
  hb as (
    select count(*) as total,
      count(*) filter (where status = 'pending')   as pending,
      count(*) filter (where status = 'confirmed') as confirmed,
      count(*) filter (where status = 'completed') as completed,
      count(*) filter (where status = 'cancelled') as cancelled,
      count(*) filter (where check_in = current_date and status <> 'cancelled') as checkin_today,
      count(*) filter (where check_out = current_date and status <> 'cancelled') as checkout_today,
      coalesce(sum(sale_total), 0) as sale_total
    from hotel_bookings where company_id = (select id from co)
  )
select jsonb_build_object(
  'as_of', (select today from bounds),
  'cash_bank', jsonb_build_object(
    'balance', (select coalesce(sum(debit - credit), 0) from gl where subtype in ('Cash', 'Bank')),
    'cash',    (select coalesce(sum(debit - credit), 0) from gl where subtype = 'Cash'),
    'bank',    (select coalesce(sum(debit - credit), 0) from gl where subtype = 'Bank')),
  'ar_ap', (select jsonb_build_object('ar', ar, 'ap', ap, 'overdue', ar_overdue,
                                      'ap_overdue', ap_overdue, 'net', ar - ap) from open_ar_ap),
  'sales', jsonb_build_object(
    'month', (select coalesce(sum(credit - debit), 0) from gl
               where acct_type = 'income' and entry_date >= (select month_start from bounds)),
    'year',  (select coalesce(sum(credit - debit), 0) from gl
               where acct_type = 'income' and entry_date >= (select year_start from bounds)),
    'total', (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'income'),
    'invoices_month', (select count(*) from td where doc_type = 'sales_invoice'
                        and doc_date >= (select month_start from bounds))),
  -- Expenses are the expense accounts that are NOT cost of sales (subtype
  -- COGS). The cost of what was sold is the business's margin, not its
  -- overhead, and the P&L shows it above Gross Profit for the same reason.
  'expenses', jsonb_build_object(
    'month', (select coalesce(sum(debit - credit), 0) from gl
               where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS' and entry_date >= (select month_start from bounds)),
    'year',  (select coalesce(sum(debit - credit), 0) from gl
               where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS' and entry_date >= (select year_start from bounds)),
    'total', (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS')),
  'pnl', jsonb_build_object(
    'income_month',  (select coalesce(sum(credit - debit), 0) from gl
                       where acct_type = 'income' and entry_date >= (select month_start from bounds)),
    'cogs_month',    (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and subtype = 'COGS' and entry_date >= (select month_start from bounds)),
    'expense_month', (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS' and entry_date >= (select month_start from bounds)),
    'income_year',   (select coalesce(sum(credit - debit), 0) from gl
                       where acct_type = 'income' and entry_date >= (select year_start from bounds)),
    'cogs_year',     (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and subtype = 'COGS' and entry_date >= (select year_start from bounds)),
    'expense_year',  (select coalesce(sum(debit - credit), 0) from gl
                       where acct_type = 'expense' and coalesce(subtype, '') <> 'COGS' and entry_date >= (select year_start from bounds))),
  'balance_sheet', jsonb_build_object(
    'assets',      (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'asset'),
    'liabilities', (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'liability'),
    'equity',      (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'equity'),
    'profit',      (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'income')
                 - (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'expense'),
    'difference',  (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'asset')
                 - (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'liability')
                 - (select coalesce(sum(credit - debit), 0) from gl where acct_type = 'equity')
                 - ((select coalesce(sum(credit - debit), 0) from gl where acct_type = 'income')
                    - (select coalesce(sum(debit - credit), 0) from gl where acct_type = 'expense'))),
  'cash_flow', jsonb_build_object(
    'in_month',   (select coalesce(sum(debit), 0) from gl
                    where subtype in ('Cash','Bank') and entry_date >= (select month_start from bounds)),
    'out_month',  (select coalesce(sum(credit), 0) from gl
                    where subtype in ('Cash','Bank') and entry_date >= (select month_start from bounds)),
    'net_month',  (select coalesce(sum(debit - credit), 0) from gl
                    where subtype in ('Cash','Bank') and entry_date >= (select month_start from bounds)),
    'in_year',    (select coalesce(sum(debit), 0) from gl
                    where subtype in ('Cash','Bank') and entry_date >= (select year_start from bounds)),
    'out_year',   (select coalesce(sum(credit), 0) from gl
                    where subtype in ('Cash','Bank') and entry_date >= (select year_start from bounds)),
    'net_year',   (select coalesce(sum(debit - credit), 0) from gl
                    where subtype in ('Cash','Bank') and entry_date >= (select year_start from bounds))),
  'car_balances', (select jsonb_build_object('balance', balance, 'overdue', overdue,
                     'due_this_month', due_this_month, 'collected', collected,
                     'sale_value', sale_value, 'advance', advance) from car_money),
  'pending_sales_orders', jsonb_build_object(
    'count', (select count(*) from td where doc_type = 'sale_order' and not consumed),
    'value', (select coalesce(sum(total), 0) from td where doc_type = 'sale_order' and not consumed),
    'oldest', (select min(doc_date) from td where doc_type = 'sale_order' and not consumed)),
  'pending_purchase_orders', jsonb_build_object(
    'count', (select count(*) from td where doc_type = 'purchase_order' and not consumed),
    'value', (select coalesce(sum(total), 0) from td where doc_type = 'purchase_order' and not consumed),
    'oldest', (select min(doc_date) from td where doc_type = 'purchase_order' and not consumed)),
  'order_status', jsonb_build_object(
    'so_qty',    (select q from so_qty),
    'stock_qty', (select qty from stock),
    'po_qty',    (select q from po_qty),
    'balance',   (select (select qty from stock) + (select q from po_qty) - (select q from so_qty))),
  'so_advance_receipt', (select jsonb_build_object(
      'order_value', order_value,
      'advance',     advance,
      'received',    received,
      'balance',     advance - received) from so_pending),
  -- Bought against sold, this month and this year. Buy is the posted Purchase
  -- Vouchers; Sale is every posted sale document; the margin is sale less the
  -- cost of what was sold, off the ledger — not sale less what was bought,
  -- which compares two cars bought with one car sold.
  'purchase_vs_sale', jsonb_build_object(
    'purchase_month', (select coalesce(sum(total), 0) from td
                        where doc_type = 'purchase_voucher' and gl_entry is not null and doc_date >= (select month_start from bounds)),
    'sale_month',     (select coalesce(sum(total), 0) from sales_docs where doc_date >= (select month_start from bounds)),
    'cogs_month',     (select coalesce(sum(debit - credit), 0) from gl
                        where acct_type = 'expense' and subtype = 'COGS' and entry_date >= (select month_start from bounds)),
    'purchase_year',  (select coalesce(sum(total), 0) from td
                        where doc_type = 'purchase_voucher' and gl_entry is not null and doc_date >= (select year_start from bounds)),
    'sale_year',      (select coalesce(sum(total), 0) from sales_docs where doc_date >= (select year_start from bounds)),
    'cogs_year',      (select coalesce(sum(debit - credit), 0) from gl
                        where acct_type = 'expense' and subtype = 'COGS' and entry_date >= (select year_start from bounds))),
  'stock', (select jsonb_build_object('qty', qty, 'value', value, 'items', items) from stock),
  'bookings', (select jsonb_build_object('total', total, 'pending', pending, 'confirmed', confirmed,
                 'completed', completed, 'cancelled', cancelled, 'checkin_today', checkin_today,
                 'checkout_today', checkout_today, 'sale_total', sale_total) from hb),
  'delivery_status', (select jsonb_build_object(
      'sold', sold + delivered, 'delivered', delivered, 'balance', sold,
      'in_stock', in_stock, 'reserved', reserved, 'held', held, 'vehicles', total,
      'invoices',       (select count(*) from td where doc_type = 'sales_invoice'),
      'delivery_notes', (select count(*) from td where doc_type = 'delivery_note')) from cars)
);
$function$;
revoke all on function public.dashboard_metrics() from public, anon;
grant execute on function public.dashboard_metrics() to authenticated;

-- ── a cash or bank voucher in a foreign currency ───────────────────────────
create or replace function public.gl_voucher_stamp_fx(p_entry uuid, p_currency text, p_rate numeric)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare e journal_entries; v_tag text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into e from journal_entries where id = p_entry and company_id = auth_company_id();
  if not found then raise exception 'Voucher not found'; end if;
  if upper(coalesce(p_currency, 'SAR')) = 'SAR' or coalesce(p_rate, 0) <= 0 then return; end if;
  v_tag := ' (' || upper(p_currency) || ' @ ' || p_rate || ')';
  update journal_entries
     set fx_currency = upper(p_currency), fx_rate = p_rate,
         memo = case when coalesce(memo, '') like '%' || v_tag then memo else trim(coalesce(memo, '') || v_tag) end
   where id = p_entry;
end $function$;
revoke all on function public.gl_voucher_stamp_fx(uuid, text, numeric) from public, anon;
grant execute on function public.gl_voucher_stamp_fx(uuid, text, numeric) to authenticated;

-- ── the bills already raised are re-billed by instalment ───────────────────
do $$
declare e record;
begin
  -- The single car-sale bills go (nothing is adjusted against them now that
  -- RCT-00001 is void) and come back by schedule.
  delete from open_items oi where oi.doc_type = 'car_sale'
     and not exists (select 1 from allocations a where a.open_item_id = oi.id);
  for e in select id from journal_entries where source = 'car_sale' and status = 'posted' loop
    perform car_contract_bills_raise(e.id);
  end loop;
  update open_items set due_date = (date_trunc('month', doc_date) + interval '1 month')::date
   where doc_type = 'car_scharge_month';
end $$;

-- ── post-conditions ────────────────────────────────────────────────────────
do $chk$
declare v_n int; v_sum numeric; v_adv numeric; v_due date; v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
        v_acct uuid; v_rcp uuid; v_contract uuid; v_entry uuid; v_out numeric; v_item uuid;
begin
  select count(*), sum(amount_base) into v_n, v_sum from open_items where doc_no like 'CI-000005%';
  if v_n <> 13 or v_sum <> 123000 then raise exception '387: CI-000005 should be 13 bills of 123,000, is % of %', v_n, v_sum; end if;
  select amount_base, due_date into v_adv, v_due from open_items where doc_no = 'CI-000005 advance';
  -- The advance is due on the date written on the invoice (26-08-26 here — the
  -- customer was to pay before the car was invoiced), not the invoice date.
  if v_adv <> 20000 or v_due <> (select coalesce(advance_due_date, contract_date) from car_contracts where contract_no = 'CI-000005') then
    raise exception '387: advance bill is % due %', v_adv, v_due;
  end if;
  if (select due_date from open_items where doc_no = 'CI-000005/3') <> date '2026-11-01' then
    raise exception '387: instalment 3 is not due on 01-11';
  end if;
  if (select due_date from open_items where doc_no = 'MSC-00001') <> date '2026-10-01' then
    raise exception '387: MSC-00001 is not due on the first of next month';
  end if;
  if exists (select 1 from open_items where due_date is null) then raise exception '387: a bill has no due date'; end if;
  if (select subtype from accounts where company_id = v_co and code = '5100') <> 'COGS' then
    raise exception '387: 5100 is not cost of sales';
  end if;
  -- The ageing: only what is due by today ages; the rest is not_due.
  if (select (r->>'not_due')::numeric from jsonb_array_elements(ar_ap_aging(v_co, 'customer')) r where r->>'name' = 'ABDUL JALAL')
       <> (select sum(outstanding_base) from open_items where direction = 'D' and due_date > current_date
            and account_id = (select id from accounts where company_id = v_co and name = 'ABDUL JALAL' and subtype = 'Receivable')) then
    raise exception '387: not_due does not agree with the bills';
  end if;
  -- The dashboard counts the car sale and leaves the cost out of expenses.
  perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);
  if (dashboard_metrics()->'purchase_vs_sale'->>'sale_month')::numeric < 123000 then
    raise exception '387: the sale card still misses the car sale';
  end if;
  if (dashboard_metrics()->'expenses'->>'total')::numeric <> 0 then
    raise exception '387: expenses still carry the cost of sales (%)', dashboard_metrics()->'expenses'->>'total';
  end if;
  if (dashboard_metrics()->'pnl'->>'cogs_month')::numeric <> 70000 then
    raise exception '387: cost of sales this month is not 70,000';
  end if;

  -- Rehearsal, rolled back: a Car Receipt of 8,583.34 against instalment 1
  -- settles that bill; re-posting the invoice re-bills and re-settles it.
  begin
    select c.id, a.id into v_contract, v_acct
      from car_contracts c join accounts a on a.party_id = c.customer_id and a.subtype = 'Receivable'
     where c.contract_no = 'CI-000005';
    insert into car_receipts(company_id, contract_id, customer_id, receipt_no, receipt_date, amount, method)
    select v_co, v_contract, customer_id, 'RCP-REHEARSAL', current_date, 8583.34, 'cash' from car_contracts where id = v_contract
    returning id into v_rcp;
    insert into car_receipt_allocations(receipt_id, target_type, installment_id, amount)
    select v_rcp, 'installment', id, 8583.34 from car_installments where contract_id = v_contract and inst_no = 1;
    perform car_post_receipt(v_rcp);
    select outstanding_base into v_out from open_items where doc_no = 'CI-000005/1';
    if v_out <> 0 then raise exception '387 rehearsal: instalment 1 still outstanding %', v_out; end if;
    -- the invoice re-posts: bills go and come back, the receipt re-settles
    select id into v_entry from journal_entries where entry_no = 'CI-000005';
    delete from journal_lines where entry_id = v_entry;
    delete from journal_entries where id = v_entry;
    if exists (select 1 from open_items where doc_no like 'CI-000005%') then raise exception '387 rehearsal: bills survived the unpost'; end if;
    perform car_post_contract(v_contract);
    select outstanding_base into v_out from open_items where doc_no = 'CI-000005/1';
    if v_out <> 0 then raise exception '387 rehearsal: instalment 1 not re-settled after re-post (%)', v_out; end if;
    if (select count(*) from open_items where doc_no like 'CI-000005%') <> 13 then raise exception '387 rehearsal: re-post did not re-bill'; end if;
    raise exception 'ROLLBACK_REHEARSAL';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REHEARSAL' then raise; end if;
  end;
  if exists (select 1 from allocations) or exists (select 1 from car_receipts where receipt_no = 'RCP-REHEARSAL') then
    raise exception '387: the rehearsal did not roll back';
  end if;
  raise notice '387 ok';
end $chk$;

commit;
