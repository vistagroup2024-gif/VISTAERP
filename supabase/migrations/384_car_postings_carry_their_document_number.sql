-- 384 — Car postings carry their document number, and Monthly Charges has one.
--
-- With one number per voucher on (383), the trade vouchers posted as their
-- own number but the car module's poster still numbered everything from the
-- Journal series — so a customer's ledger read JOU-00008 against a Car Invoice
-- that is CI-000005. car_post_entry now gives a posting raised by a numbered
-- document (CI-, RCP-, CAR-) that number when the setting is on. The month
-- voucher had no document number of its own at all; it has a series now,
-- MSC-, on the numbering screen. The three entries already posted are
-- renumbered to their documents. Applied by hand; kept here for the record.
begin;
insert into doc_sequences(company_id, doc_type, prefix, padding, next_number)
select c.id, 'car_scharge_month', 'MSC-', 5, 1 from companies c
on conflict (company_id, doc_type) do nothing;

create or replace function public.car_post_entry(p_company uuid, p_date date, p_memo text, p_source text, p_reference text, p_lines jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_entry uuid; v_no text; v_one boolean;
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
  return true;
end $function$;

update journal_entries set entry_no = 'CI-000005' where entry_no = 'JOU-00008' and source = 'car_sale' and reference = 'CI-000005';
update journal_entries set entry_no = 'PV-00003'  where entry_no = 'JPV-00004' and source = 'purchase_voucher' and reference = 'PV-00003';
update journal_entries set entry_no = next_doc_number(company_id, 'car_scharge_month') where entry_no = 'JOU-00009' and source = 'car_scharge_month';
commit;
