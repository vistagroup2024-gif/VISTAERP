-- 382 — Receipt, Payment, Journal, Contra and PDC number as RCT-00001.
--
-- The five accounting vouchers were seeded years ago as Rct:1, Pmt:1, Jrn:1,
-- Cnt:1, Pdc:1 — one digit, a colon — while every other series is five digits
-- with a dash. Set to RCT-, PMT-, JRN-, CNT-, PDC- at five digits, as asked.
-- None had issued a number yet, so nothing already on the ledger changes.
-- From here on this is set on Settings → Company → Voucher Numbering.
begin;
update doc_sequences s set prefix = t.prefix, padding = 5
  from (values ('gl_receipt','RCT-'),('gl_payment','PMT-'),('gl_journal','JRN-'),('gl_contra','CNT-'),('gl_pdc','PDC-')) t(doc_type, prefix)
 where s.doc_type = t.doc_type;
commit;
