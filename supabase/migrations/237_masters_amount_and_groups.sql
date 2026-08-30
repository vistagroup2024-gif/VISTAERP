-- 237_masters_amount_and_groups.sql
-- Master refinements:
--   * Car Purchase Expense gets an amount (default expense amount for the head).
--   * Cost Center and Tag Area become hierarchical (groups + items), like the
--     Product Tree — add parent_id / is_group / sort.
alter table acct_car_purchase_expenses add column if not exists amount numeric not null default 0;

alter table acct_cost_centers add column if not exists parent_id uuid references acct_cost_centers(id) on delete set null;
alter table acct_cost_centers add column if not exists is_group boolean not null default false;
alter table acct_cost_centers add column if not exists sort int not null default 0;

alter table acct_tag_areas add column if not exists parent_id uuid references acct_tag_areas(id) on delete set null;
alter table acct_tag_areas add column if not exists is_group boolean not null default false;
alter table acct_tag_areas add column if not exists sort int not null default 0;
