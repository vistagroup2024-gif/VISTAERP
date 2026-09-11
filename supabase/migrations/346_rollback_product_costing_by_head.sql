-- Undo 346. The per-head costing rows go; expense_rate keeps whatever the last
-- sync left on it, which is the sum of the rows being dropped — so total_cost
-- does not move and nothing that prices a car from it changes. Type over
-- expense_rate by hand again afterwards if that is wanted.
--
-- The four seeded expense heads are NOT deleted: by the time this runs a Car
-- Expense voucher may have been raised against one, and deleting a head a
-- voucher points at is a worse outcome than leaving four unused rows in a
-- master the user can tidy themselves.

begin;

drop function if exists public.product_costing_save(uuid, numeric, jsonb);
drop trigger if exists trg_acct_product_costing_sync on public.acct_product_costing;
drop function if exists public.acct_product_costing_sync();
drop table if exists public.acct_product_costing;

commit;
