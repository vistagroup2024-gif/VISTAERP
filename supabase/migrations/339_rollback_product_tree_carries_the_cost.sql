-- Undo 339: the Product Tree stops carrying the expense half of an item's cost.
--
-- Both columns go. Any Expenses figure typed against an item is lost with them —
-- it lives nowhere else. Quotations already saved keep the Total Cost (COGS)
-- they were saved with: that figure is copied into the document's own meta when
-- the quotation is saved, not read back from the item.

alter table acct_products drop column if exists total_cost;
alter table acct_products drop column if exists expense_rate;
