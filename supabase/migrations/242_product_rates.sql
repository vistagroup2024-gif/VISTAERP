-- 242_product_rates.sql
-- Product Tree gains a purchase rate (supplier cost) and sell rate (customer /
-- agent price) per item. These drive automatic invoice pricing for the module
-- invoices (Visa first): line gross = qty × sell_rate, supplier amount = qty ×
-- purchase_rate. Group/parent rows leave them 0.
alter table acct_products add column if not exists purchase_rate numeric(18,2) not null default 0;
alter table acct_products add column if not exists sell_rate     numeric(18,2) not null default 0;
