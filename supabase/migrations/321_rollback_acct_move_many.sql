-- ROLLBACK for 321_acct_move_many.sql.
--
-- Removes the bulk move. The tree falls back to moving one account at a time,
-- which is what it did before. Accounts already moved stay where they were put
-- — the move is just a parent_id, and it is a legitimate one.

drop function if exists acct_move_many(uuid[], uuid);
