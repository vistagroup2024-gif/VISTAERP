-- ROLLBACK for 323_product_costing_voucher.sql.
--
-- Removes the Product Costing voucher and everything it saved.
--
-- READ THIS BEFORE RUNNING IT. The tables are DROPPED, so every cost sheet goes
-- with them. Nothing else references one — a sheet posts nothing and its only
-- lasting effect is the rate it may have written onto an item, which stays on
-- the item and is not touched here. But the working-out behind those rates is
-- gone. Check what would go:
--
--     select sheet_no, sheet_date, item_name, cost_per_unit, sell_price, applied_at
--       from costing_sheets order by sheet_no;

drop function if exists costing_sheet_apply(uuid, boolean, boolean);
drop function if exists costing_sheet_delete(uuid);
drop function if exists costing_sheets_list(int);
drop function if exists costing_sheet_get(uuid);
drop function if exists costing_sheet_save(uuid, jsonb, jsonb);

delete from workflow_steps where doc_type = 'product_costing';
delete from doc_sequences  where doc_type = 'costing_sheet';

drop table if exists costing_sheet_lines;
drop table if exists costing_sheets;
