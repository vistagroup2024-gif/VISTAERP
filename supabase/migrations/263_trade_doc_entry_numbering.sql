-- 263_trade_doc_entry_numbering.sql
-- Journal numbers for posted trade documents.
--
-- gl_post numbers its entry with next_doc_number(company, 'gl_trade_<type>'),
-- and next_doc_number seeds an unseen doc type with upper(left(doc_type,3))||'-'.
-- For every gl_trade_* type that is the same three characters — 'GL_-' — so each
-- type got its own counter behind an identical prefix: the first Sales Return
-- posts GL_-00001, and the first Purchase Voucher then tries GL_-00001 too and
-- fails on journal_entries_company_id_entry_no_key. Seeding a distinct prefix per
-- type keeps the numbers unique and readable. Idempotent, and safe to re-run.
insert into doc_sequences(company_id, doc_type, prefix)
select c.id, t.doc_type, t.prefix
from companies c
cross join (values
  ('gl_trade_purchase_voucher', 'JPV-'),
  ('gl_trade_purchase_return',  'JPR-'),
  ('gl_trade_sales_return',     'JSR-')
) t(doc_type, prefix)
on conflict (company_id, doc_type) do nothing;

-- Repair any sequence already created with the ambiguous 'GL_-' prefix.
update doc_sequences s set prefix = t.prefix
from (values
  ('gl_trade_purchase_voucher', 'JPV-'),
  ('gl_trade_purchase_return',  'JPR-'),
  ('gl_trade_sales_return',     'JSR-')
) t(doc_type, prefix)
where s.doc_type = t.doc_type and s.prefix = 'GL_-';
