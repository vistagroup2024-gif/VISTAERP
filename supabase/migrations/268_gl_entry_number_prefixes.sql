-- 268_gl_entry_number_prefixes.sql
-- Journal numbers for the posting paths unblocked by 267.
--
-- gl_post numbers its entry with next_doc_number(company, doc_type), and
-- next_doc_number seeds an unknown doc type with upper(left(doc_type,3))||'-'.
-- Every gl_* type therefore shares the prefix 'GL_-' while keeping its own
-- counter, so the first two types to post both produce GL_-00001 and the second
-- one dies on journal_entries_company_id_entry_no_key.
--
-- The types already in use were seeded with readable prefixes long ago
-- (Rct:, Pmt:, Jrn:, Cnt:, Bil:, Inv:, Pdc:) and migration 263 did the same for
-- the trade documents. The types below were never reachable because their
-- callers all failed on the gl_post arity bug — now that 267 fixes that, they
-- would start posting and collide. Seed them the same way.
insert into doc_sequences(company_id, doc_type, prefix)
select c.id, t.doc_type, t.prefix
from companies c
cross join (values
  ('gl_visa_cost',          'Vsa:'),
  ('gl_transport',          'Trp:'),
  ('gl_payroll',            'Pay:'),
  ('gl_commission_accrual', 'Com:'),
  ('gl_stock_in',           'StI:'),
  ('gl_stock_out',          'StO:'),
  ('gl_petty',              'Pty:')
) t(doc_type, prefix)
on conflict (company_id, doc_type) do nothing;

-- Repair any sequence already created under the ambiguous fallback prefix.
update doc_sequences s set prefix = t.prefix
from (values
  ('gl_visa_cost',          'Vsa:'),
  ('gl_transport',          'Trp:'),
  ('gl_payroll',            'Pay:'),
  ('gl_commission_accrual', 'Com:'),
  ('gl_stock_in',           'StI:'),
  ('gl_stock_out',          'StO:'),
  ('gl_petty',              'Pty:')
) t(doc_type, prefix)
where s.doc_type = t.doc_type and s.prefix = 'GL_-';
