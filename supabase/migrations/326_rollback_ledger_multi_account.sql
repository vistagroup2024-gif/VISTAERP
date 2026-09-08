-- ROLLBACK for 326_ledger_multi_account.sql.
--
-- Removes the multi-account ledger. acct_ledger is untouched throughout, so the
-- single-account ledger keeps working either way — this only takes away the
-- routine the new screen calls.

drop function if exists acct_ledger_multi(uuid, uuid[], date, date, boolean, boolean, text);
