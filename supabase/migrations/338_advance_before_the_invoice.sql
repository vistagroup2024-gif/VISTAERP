-- An advance can be received before the Car Invoice exists.
--
-- A car sale starts as a Sale Order, and the customer pays the advance to hold
-- the car — days or weeks before the Car Invoice is raised. There was nowhere to
-- record that. A Car Receipt could only be taken from inside a Car Invoice
-- (`car_receipts.contract_id` was NOT NULL and the only entry point was the
-- Receive Payment panel on the contract), so the money sat in the drawer with
-- nothing in the ledger saying whose it was, and when the invoice was finally
-- raised its advance showed as Due on the dashboard although it had been paid.
--
-- A receipt is now anchored to EITHER a Car Invoice or the Sale Order it is an
-- advance against, and it posts the same way either side of that line — the one
-- posting this schema already believes in:
--
--     Dr Cash / Bank        Cr the customer's own account
--
-- which puts the customer in credit until the invoice debits them. Nothing lands
-- in a control bucket, exactly as migration 331 established.
--
-- When the Car Invoice is raised from that order, `car_contract_link_source` —
-- the routine that ties the two together — ADOPTS those receipts: their
-- contract_id is filled in and their `advance` allocation is already there, so
-- the invoice's advance reads as paid the moment it exists and never appears as
-- Due. Nothing is re-posted and nothing is reversed; the money was always the
-- customer's.
--
-- TWO THINGS IN THE SAME FLOW WERE BROKEN AND ARE FIXED HERE, because building
-- on top of them would have made the advance wrong in a new way:
--
-- 1. NO CAR RECEIPT EVER REACHED THE LEDGER. `trg_car_autopost_receipt` fired
--    AFTER INSERT only, and `car_receipt_save` inserts a bare row (amount
--    defaults to 0) and sets the amount in the UPDATE that follows. So the
--    posting ran against a zero amount: `car_post_entry` wrote a journal entry
--    header, filtered both zero lines away, and returned true. That entry is
--    keyed (source, reference) = ('car_receipt', receipt_no), so the real
--    posting a moment later was refused as a duplicate — for ever. Every car
--    receipt would have been an empty journal entry. Nobody had hit it because
--    no receipt has been taken yet.
--
--    `car_post_receipt` now refuses a zero amount (a receipt with no money on it
--    is not a posting), and the trigger also fires on the update that puts the
--    amount there. The two changes only work together.
--
-- 2. DELETING A RECEIPT LEFT ITS CASH IN THE LEDGER. `car_receipt_delete`
--    removed the row and left the journal entry standing, so the cash book kept
--    money that no receipt claimed. It now unposts, the way
--    `car_contract_unpost` does for an invoice.

-- ------------------------------------------------- 1. a receipt can stand alone

alter table car_receipts alter column contract_id drop not null;

alter table car_receipts
  add column if not exists source_doc_id uuid references trade_documents(id) on delete restrict;

create index if not exists car_receipts_source_doc_idx on car_receipts(source_doc_id);

-- The Receipt Voucher asks WHICH cash or bank account the money went into, and
-- a company with three banks needs that answer. A car receipt only ever carried
-- a method word, which the posting turned into the house Cash (1000) or Bank
-- (1010) account. The account is recorded when it is chosen; the method stays as
-- the fallback, so every receipt taken before this still posts where it did.
alter table car_receipts
  add column if not exists cash_account_id uuid references accounts(id);

-- A receipt is money against something. It is never against nothing.
alter table car_receipts drop constraint if exists car_receipts_anchored;
alter table car_receipts add constraint car_receipts_anchored
  check (contract_id is not null or source_doc_id is not null);

-- --------------------------------------------------------- 2. posting a receipt

create or replace function car_post_receipt(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare r car_receipts; cc text; ta text; v_cust uuid; v_cash uuid;
begin
  select * into r from car_receipts where id = p_id;
  if not found then return false; end if;

  -- The row is inserted bare and its amount arrives in the update that follows.
  -- Posting it before then wrote an empty entry that blocked the real one.
  if coalesce(r.amount, 0) <= 0 then return false; end if;

  perform car_ensure_accounts(r.company_id);

  if r.contract_id is not null then
    select coalesce(nullif(btrim(cost_center),''), car_cost_center(vehicle_id)),
           coalesce(nullif(btrim(tag_area),''), car_tag_area(vehicle_id))
      into cc, ta from car_contracts where id = r.contract_id;
  else
    -- An advance against a Sale Order takes the order's cost centre; there is no
    -- contract and no vehicle to read one from yet.
    select nullif(btrim(d.cost_center),''), nullif(btrim(d.tag_area),'')
      into cc, ta from trade_documents d where d.id = r.source_doc_id;
  end if;

  v_cust := coalesce(car_party_account(r.customer_id), acct(r.company_id, '1150'));
  v_cash := coalesce(r.cash_account_id,
                     acct(r.company_id, case when r.method = 'cash' then '1000' else '1010' end));

  return car_post_entry(r.company_id, r.receipt_date,
    case when r.contract_id is null then 'Advance receipt ' else 'Installment receipt ' end || r.receipt_no,
    'car_receipt', r.receipt_no,
    jsonb_build_array(jsonb_build_object('account_id', v_cash, 'debit', r.amount,
                                         'cost_center', cc, 'tag_area', ta),
                      jsonb_build_object('account_id', v_cust, 'credit', r.amount,
                                         'cost_center', cc, 'tag_area', ta)));
end $fn$;

-- The amount arrives after the insert, so the posting has to watch for it. The
-- zero guard above is what stops the insert itself posting an empty entry.
drop trigger if exists trg_car_autopost_receipt on car_receipts;
create trigger trg_car_autopost_receipt
  after insert or update of amount, method, receipt_date, customer_id
  on car_receipts for each row execute function car_autopost_trigger('receipt');

-- Any empty car_receipt entry left by the old behaviour would block the real
-- posting for ever. There are none today; this is here so re-running is safe.
do $$
declare n int;
begin
  with dead as (
    select e.id from journal_entries e
     where e.source = 'car_receipt'
       and not exists (select 1 from journal_lines l where l.entry_id = e.id)
  ), gone as (delete from journal_entries e using dead d where e.id = d.id returning 1)
  select count(*) into n from gone;
  if n > 0 then raise notice 'Removed % empty car receipt entr(y/ies).', n; end if;
end $$;

-- ------------------------------------------------------------ 3. saving one

create or replace function car_receipt_save(p_id uuid, p_header jsonb, p_allocs jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_company uuid := auth_company_id(); v_id uuid; v_no text;
  v_contract uuid := nullif(p_header->>'contract_id','')::uuid;
  v_doc      uuid := nullif(p_header->>'source_doc_id','')::uuid;
  v_amount numeric := coalesce(nullif(p_header->>'amount','')::numeric, 0);
  v_alloc_total numeric; a jsonb; v_cust uuid; v_allocs jsonb; v_anchor uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if v_contract is null and v_doc is null then
    raise exception 'Choose the Car Invoice, or the Sale Order this advance is against.';
  end if;
  if v_amount <= 0 then raise exception 'Enter a receipt amount'; end if;

  if v_contract is not null then
    select customer_id into v_cust from car_contracts where id = v_contract and company_id = v_company;
    if not found then raise exception 'Contract not found'; end if;
    v_doc := null;                       -- once the invoice exists, it is the anchor
    v_allocs := coalesce(p_allocs, '[]'::jsonb);
  else
    -- An advance taken before the invoice belongs to the Sale Order and to the
    -- customer named on it. There is no schedule to allocate against yet, so the
    -- whole receipt is the advance — said here rather than trusted to the caller.
    select d.party_id into v_cust
      from trade_documents d
     where d.id = v_doc and d.company_id = v_company and d.doc_type = 'sale_order'
       and is_car_cost_center(d.cost_center);
    if v_cust is null then
      raise exception 'That is not a car Sale Order, or it has no customer on it.';
    end if;
    if exists (select 1 from car_contracts c
                where c.company_id = v_company and c.source_doc_id = v_doc) then
      raise exception 'That Sale Order is already invoiced — take the receipt against the Car Invoice.';
    end if;
    v_allocs := jsonb_build_array(jsonb_build_object('target_type', 'advance', 'amount', v_amount::text));
  end if;

  v_alloc_total := coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(v_allocs) e), 0);
  if round(v_alloc_total, 2) > round(v_amount, 2) then
    raise exception 'Allocated (%) exceeds the receipt amount (%).', round(v_alloc_total,2), round(v_amount,2);
  end if;

  if p_id is null then
    v_no := 'RCP-' || lpad(nextval('car_receipt_seq')::text, 6, '0');
    insert into car_receipts(company_id, receipt_no, contract_id, source_doc_id, customer_id, created_by)
    values (v_company, v_no, v_contract, v_doc, v_cust, auth.uid()) returning id into v_id;
  else
    v_id := p_id;
    delete from car_receipt_allocations where receipt_id = v_id;
  end if;

  update car_receipts set
    contract_id   = coalesce(v_contract, contract_id),
    source_doc_id = coalesce(v_doc, source_doc_id),
    customer_id   = v_cust,
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
  values (v_company, auth.uid(), case when p_id is null then 'car_receipt_created' else 'car_receipt_updated' end,
          'car_receipt', v_id, jsonb_build_object('amount', v_amount, 'allocated', v_alloc_total,
                                                  'against', case when v_anchor is null then 'sale_order' else 'car_invoice' end));
  return v_id;
end $fn$;

-- ---------------------------------------------------------- 4. deleting one

create or replace function car_receipt_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_company uuid := auth_company_id(); v_contract uuid; v_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select contract_id, receipt_no into v_contract, v_no
    from car_receipts where id = p_id and company_id = v_company;
  if not found then raise exception 'Receipt not found'; end if;

  delete from car_receipts where id = p_id and company_id = v_company;

  -- Take the posting with it. Leaving it standing kept cash in the book that no
  -- receipt claimed, and blocked the reference if the receipt were raised again.
  delete from journal_lines where entry_id in (
    select id from journal_entries
     where company_id = v_company and source = 'car_receipt' and reference = v_no);
  delete from journal_entries
   where company_id = v_company and source = 'car_receipt' and reference = v_no;

  perform car_recompute_installments(v_contract);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_receipt_deleted', 'car_receipt', p_id,
          jsonb_build_object('receipt_no', v_no));
end $fn$;

-- ------------------------------------------- 5. the invoice adopts the advance

create or replace function car_contract_link_source(p_contract uuid, p_doc uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_co uuid := auth_company_id(); n int;
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

  -- Any advance already received against the order is the same money as the
  -- advance on this invoice. Adopting the receipt is all it takes: its `advance`
  -- allocation is already there, so the invoice reads as advance-paid and the
  -- dashboard stops asking for it. Nothing is re-posted — it was always a debit
  -- to cash and a credit to this customer.
  update car_receipts set contract_id = p_contract
   where company_id = v_co and source_doc_id = p_doc and contract_id is null;
  get diagnostics n = row_count;
  if n > 0 then
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (v_co, auth.uid(), 'car_advance_receipts_adopted', 'car_contract', p_contract,
            jsonb_build_object('sale_order', p_doc, 'receipts', n));
  end if;
end $fn$;

-- ------------------------------- 6. the dashboard counts the advance received

-- Sale Order · Advance vs Receipt read what had been received THROUGH THE CAR
-- CONTRACT, which by definition does not exist while the order is on that card.
-- The receipt names the order itself now, so ask it directly.
do $$
declare
  v_def text; v_new text;
  pat constant text :=
    '\(select sum\(r\.amount\) from car_receipts r\s+join car_contracts cc on cc\.id = r\.contract_id\s+where cc\.source_doc_id = d\.id\)';
  repl constant text :=
    '(select sum(r.amount) from car_receipts r where r.source_doc_id = d.id)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dashboard_metrics';
  if v_def is null then raise exception 'dashboard_metrics is not there.'; end if;

  if position(repl in v_def) > 0 then
    raise notice 'Already applied - the card reads receipts off the order.';
    return;
  end if;

  -- Exactly one, or the rule is not the one this migration was written against.
  if (select count(*) from regexp_matches(v_def, pat, 'g')) <> 1 then
    raise exception 'Expected exactly one Sale Order receipt rule to change, found %.',
      (select count(*) from regexp_matches(v_def, pat, 'g'));
  end if;

  v_new := regexp_replace(v_def, pat, repl);
  if v_new = v_def or length(v_def) - length(v_new) not between 1 and 200 then
    raise exception 'The patch changed % characters, which is not the shape expected.',
      length(v_def) - length(v_new);
  end if;

  execute v_new;
  raise notice 'Sale Order receipts are counted off the order itself.';
end $$;
