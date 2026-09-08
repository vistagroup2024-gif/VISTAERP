-- Undo 338: a Car Receipt is only ever taken against a Car Invoice again.
--
-- This REFUSES rather than destroys. If an advance has actually been received
-- against a Sale Order that has not been invoiced yet, there is nowhere for that
-- receipt to live under the old shape — so the rollback stops and says so, and
-- the receipt is deleted (which now unposts it) or its invoice raised first.
--
-- Note what does NOT come back: the two bugs fixed alongside. The trigger
-- returns to AFTER INSERT, so car receipts stop reaching the ledger again, and
-- deleting a receipt leaves its posting standing. That is what the old code did.

do $$
declare v_no text;
begin
  select string_agg(receipt_no, ', ' order by receipt_no) into v_no
    from car_receipts where contract_id is null;
  if v_no is not null then
    raise exception 'Receipt % is an advance against a Sale Order with no invoice yet. Delete it, or raise the invoice, before rolling back.', v_no;
  end if;
end $$;

drop trigger if exists trg_car_autopost_receipt on car_receipts;
create trigger trg_car_autopost_receipt
  after insert on car_receipts for each row execute function car_autopost_trigger('receipt');

create or replace function car_post_receipt(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $fn$
declare r car_receipts; cc text; ta text; v_cust uuid;
begin
  select * into r from car_receipts where id = p_id;
  if not found then return false; end if;
  perform car_ensure_accounts(r.company_id);
  select coalesce(nullif(btrim(cost_center),''), car_cost_center(vehicle_id)),
         coalesce(nullif(btrim(tag_area),''), car_tag_area(vehicle_id))
    into cc, ta from car_contracts where id = r.contract_id;
  v_cust := coalesce(car_party_account(r.customer_id), acct(r.company_id, '1150'));
  return car_post_entry(r.company_id, r.receipt_date, 'Installment receipt ' || r.receipt_no,
    'car_receipt', r.receipt_no,
    jsonb_build_array(jsonb_build_object('code', case when r.method = 'cash' then '1000' else '1010' end,
                                         'debit', r.amount, 'cost_center', cc, 'tag_area', ta),
                      jsonb_build_object('account_id', v_cust, 'credit', r.amount, 'cost_center', cc, 'tag_area', ta)));
end $fn$;

create or replace function car_receipt_save(p_id uuid, p_header jsonb, p_allocs jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_company uuid := auth_company_id(); v_id uuid; v_no text;
  v_contract uuid := nullif(p_header->>'contract_id','')::uuid;
  v_amount numeric := coalesce(nullif(p_header->>'amount','')::numeric, 0);
  v_alloc_total numeric; a jsonb; v_cust uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if v_contract is null then raise exception 'Select a contract'; end if;
  if v_amount <= 0 then raise exception 'Enter a receipt amount'; end if;

  v_alloc_total := coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(p_allocs,'[]'::jsonb)) e), 0);
  if round(v_alloc_total, 2) > round(v_amount, 2) then
    raise exception 'Allocated (%) exceeds the receipt amount (%).', round(v_alloc_total,2), round(v_amount,2);
  end if;

  select customer_id into v_cust from car_contracts where id = v_contract and company_id = v_company;
  if not found then raise exception 'Contract not found'; end if;

  if p_id is null then
    v_no := 'RCP-' || lpad(nextval('car_receipt_seq')::text, 6, '0');
    insert into car_receipts(company_id, receipt_no, contract_id, customer_id, created_by)
    values (v_company, v_no, v_contract, v_cust, auth.uid()) returning id into v_id;
  else
    v_id := p_id;
    delete from car_receipt_allocations where receipt_id = v_id;
  end if;

  update car_receipts set
    contract_id = v_contract, customer_id = v_cust,
    receipt_date = coalesce(nullif(p_header->>'receipt_date','')::date, current_date),
    amount = v_amount,
    method = coalesce(nullif(p_header->>'method',''), 'cash'),
    reference = nullif(p_header->>'reference',''),
    notes = nullif(p_header->>'notes','')
  where id = v_id and company_id = v_company;

  for a in select * from jsonb_array_elements(coalesce(p_allocs,'[]'::jsonb)) loop
    if coalesce(nullif(a->>'amount','')::numeric,0) <> 0 then
      insert into car_receipt_allocations(receipt_id, target_type, installment_id, amount)
      values (v_id, coalesce(nullif(a->>'target_type',''),'installment'),
              nullif(a->>'installment_id','')::uuid, (a->>'amount')::numeric);
    end if;
  end loop;

  perform car_recompute_installments(v_contract);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when p_id is null then 'car_receipt_created' else 'car_receipt_updated' end,
          'car_receipt', v_id, jsonb_build_object('amount', v_amount, 'allocated', v_alloc_total));
  return v_id;
end $fn$;

create or replace function car_receipt_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_company uuid := auth_company_id(); v_contract uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select contract_id into v_contract from car_receipts where id = p_id and company_id = v_company;
  if not found then raise exception 'Receipt not found'; end if;
  delete from car_receipts where id = p_id and company_id = v_company;
  perform car_recompute_installments(v_contract);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_receipt_deleted', 'car_receipt', p_id, '{}'::jsonb);
end $fn$;

create or replace function car_contract_link_source(p_contract uuid, p_doc uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_co uuid := auth_company_id();
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
end $fn$;

alter table car_receipts drop constraint if exists car_receipts_anchored;
drop index if exists car_receipts_source_doc_idx;
alter table car_receipts drop column if exists source_doc_id;
alter table car_receipts alter column contract_id set not null;

do $$
declare
  v_def text; v_new text;
  pat constant text := '\(select sum\(r\.amount\) from car_receipts r where r\.source_doc_id = d\.id\)';
  repl constant text := '(select sum(r.amount) from car_receipts r join car_contracts cc on cc.id = r.contract_id where cc.source_doc_id = d.id)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dashboard_metrics';
  if (select count(*) from regexp_matches(v_def, pat, 'g')) <> 1 then
    raise notice 'The Sale Order receipt rule is not the one 338 left; leaving it alone.';
    return;
  end if;
  v_new := regexp_replace(v_def, pat, repl);
  execute v_new;
end $$;
