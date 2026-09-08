-- ROLLBACK for 324_car_expense_head_vendor.sql.
--
-- The Car Expense voucher stops filling the vendor in from the head; it is
-- chosen on every voucher again, as it was.
--
-- The column is NOT dropped, because a head's usual vendor is somebody's
-- typing and dropping it throws that away for no gain — nothing reads it once
-- the screens are rolled back. Drop it by hand if you are sure:
--
--     alter table acct_car_purchase_expenses drop column credit_account;
--
-- Vouchers already saved are untouched either way: the vendor was copied onto
-- them at the time, and it lives on their ledger entry, not on the head.

drop function if exists car_expense_credit_accounts();
