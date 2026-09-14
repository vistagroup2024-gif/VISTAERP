-- 379 — The twelve transport invoices raised while the rule was on are removed.
--
-- Between migration 377 switching the transport raise rule on and 378
-- switching it off, completing the stuck trips from the alert list raised
-- TI-00001 to TI-00012 and posted each to the ledger. Nobody had asked for
-- those, so at the business's word they are gone: lines, ledger entries and
-- documents, and each trip reads not invoiced again (the source-sync trigger
-- clears it on delete). Applied to production by hand; kept here so the
-- repo says what the database does. The TI- numbers 1–12 stay consumed.
begin;
with docs as (select id, gl_entry from trade_documents where doc_type = 'transport_invoice' and doc_no between 'TI-00001' and 'TI-00012'),
 dl as (delete from trade_document_lines where doc_id in (select id from docs) returning 1),
 jl as (delete from journal_lines where entry_id in (select gl_entry from docs where gl_entry is not null) returning 1),
 je as (delete from journal_entries where id in (select gl_entry from docs where gl_entry is not null) returning 1)
delete from trade_documents where id in (select id from docs);
commit;
