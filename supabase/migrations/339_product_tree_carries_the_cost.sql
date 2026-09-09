-- A vehicle's cost is two numbers in the Product Tree, and their total is one.
--
-- The Sales Quotation asks for Total Cost (COGS) — the figure the whole margin
-- is calculated from — and it was typed from memory every time. The number is
-- knowable: it is what the vehicle costs to BUY plus the expenses that land on
-- it afterwards (registration, insurance, transport, customs). Both belong to
-- the item, not to the quotation, so they live on the item:
--
--     Purchase Rate   what the supplier charges for it     (already there)
--     Expenses        what it costs to make it sellable    (new)
--     Total Cost      Purchase Rate + Expenses             (new, computed)
--
-- TOTAL IS A GENERATED COLUMN, not a third box to fill in. A total anyone can
-- type is a total that can disagree with its own two halves, and then two
-- screens quote different costs for the same car with nothing saying which is
-- right. Postgres computes it on write; there is nothing to keep in step.
--
-- WHAT USES WHICH, and the distinction is the point:
--
--   Purchase Order  reads PURCHASE RATE, as it already did. It is the ceiling a
--                   supplier's price is checked against, and the expenses are
--                   not the supplier's to charge. Nothing here changes that —
--                   putting the total there would allow paying the supplier the
--                   registration too, which is the bug migration-era note in
--                   TradeVoucher already warns about.
--   Sales Quotation reads TOTAL COST into Total Cost (COGS), because what the
--                   margin has to cover is the whole cost of the car, not just
--                   the invoice from the yard.
--
-- This is an ESTIMATE for quoting, and it is not the same thing as
-- `car_vehicles.total_cost`, which is the actual landed cost of one physical
-- car — its purchase voucher plus the Car Expense vouchers raised against it,
-- kept live by car_contract_sync_cost. The Product Tree figure is what a car of
-- this kind is expected to cost before one has been bought; the vehicle figure
-- is what this one did cost. Quoting uses the first, the ledger uses the second.
--
-- Nothing is back-filled: every item starts with Expenses 0, so its Total Cost
-- equals its Purchase Rate and every existing quotation and order is unchanged.

alter table acct_products
  add column if not exists expense_rate numeric not null default 0;

comment on column acct_products.expense_rate is
  'Expected cost of making the item sellable (registration, insurance, transport). Quoting estimate — not the actual expenses posted against a vehicle.';

alter table acct_products
  add column if not exists total_cost numeric
  generated always as (coalesce(purchase_rate, 0) + coalesce(expense_rate, 0)) stored;

comment on column acct_products.total_cost is
  'Purchase Rate + Expenses. Computed — it cannot be written, so it cannot disagree with its two halves. This is what a Sales Quotation reads into Total Cost (COGS).';
