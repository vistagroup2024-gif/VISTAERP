-- 269_doc_number_no_truncate.sql
-- Document numbers silently wrapped after the 9th document of a type.
--
-- next_doc_number built the number with
--     rec.prefix || lpad(n::text, rec.padding, '0')
-- and lpad TRUNCATES when the string is longer than the requested width:
--     lpad('9',1,'0')  = '9'
--     lpad('10',1,'0') = '1'     <-- back to the first number
--     lpad('325',1,'0')= '3'
-- Seven doc types carry padding = 1 — gl_receipt, gl_payment, gl_journal,
-- gl_contra, gl_sales, gl_purchase, gl_pdc, i.e. Receipt, Payment, Journal,
-- Contra, sales invoice, purchase bill and PDC. Each of them would hand out
-- Inv:1 … Inv:9 and then Inv:1 again, so the 10th voucher of any of those types
-- dies on journal_entries_company_id_entry_no_key.
--
-- It surfaced on the visa backlog: of 325 groups only 9 could ever be invoiced,
-- and the other 316 failed with that duplicate key. It would equally have hit
-- the 10th receipt or the 10th payment anyone posted.
--
-- Padding is a MINIMUM width, never a maximum: keep zero-padding short numbers
-- and let long ones through unchanged. Existing series continue naturally
-- (Inv:9 -> Inv:10), so no already-issued number changes.
create or replace function next_doc_number(p_company uuid, p_doc_type text)
returns text language plpgsql security definer set search_path = public as $$
declare
  rec doc_sequences%rowtype;
  n   text;
begin
  insert into doc_sequences(company_id, doc_type, prefix)
  values (p_company, p_doc_type, upper(left(p_doc_type,3)) || '-')
  on conflict (company_id, doc_type) do nothing;

  update doc_sequences
    set next_number = next_number + 1
    where company_id = p_company and doc_type = p_doc_type
    returning * into rec;

  n := (rec.next_number - 1)::text;
  -- greatest(...) keeps lpad from shortening a number wider than the padding.
  return rec.prefix || lpad(n, greatest(coalesce(rec.padding, 0), length(n)), '0');
end;
$$;
