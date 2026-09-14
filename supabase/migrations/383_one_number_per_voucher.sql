-- 383 — One number per voucher.
--
-- The ledger entry behind a trade voucher carries the document's own number
-- (ledger_uses_doc_no = true): PV-00003 posts as PV-00003. Asked for, and
-- applied by hand on production; recorded here. The "— entry" series for the
-- trade vouchers stay in doc_sequences, unused while this is on, and the
-- numbering screen hides them.
begin;
insert into erp_settings(key, value, updated_at) values ('ledger_uses_doc_no', 'true', now())
on conflict (key) do update set value = 'true', updated_at = now();
commit;
