-- 399 — Cascading filters (2/2): a Product Tree group or an Accounts group can
-- be told which cost centre it belongs to, so a voucher can narrow its item
-- and account pickers to what is actually relevant once a cost centre is
-- chosen — car parts under CAR SALES INSTALLMENT, transport accounts under
-- VISTA TRANSPORT, and so on. A leaf with nothing set inherits its nearest
-- tagged ancestor, resolved in the browser from the tree already loaded
-- there (ProductPicker/AccountPicker already work from an in-memory list;
-- this adds one more field to walk rather than a round trip per pick).
--
-- Every other cost centre in this schema is a name on a voucher line, on
-- purpose (migration 364 / CLAUDE.md) — text because a voucher's own cost
-- centre is chosen freely, not confined to a tree. This is a different
-- question: which MASTER-DATA group does a cost centre own, which is
-- exactly the kind of relationship a real foreign key is for, and the first
-- one anywhere in this schema pointing at acct_cost_centers.

alter table acct_products add column if not exists cost_center_id uuid references acct_cost_centers(id) on delete set null;
alter table accounts      add column if not exists cost_center_id uuid references acct_cost_centers(id) on delete set null;

create index if not exists acct_products_cost_center_idx on acct_products(cost_center_id) where cost_center_id is not null;
create index if not exists accounts_cost_center_idx      on accounts(cost_center_id)      where cost_center_id is not null;

do $chk$
declare v_co uuid; v_group uuid; v_cc uuid; v_read uuid;
begin
  -- Rehearsed in a real transaction, rolled back: tag a real Product Tree
  -- group with a real cost centre and read it straight back.
  select company_id into v_co from acct_products where is_group limit 1;
  if v_co is null then
    raise notice 'No Product Tree group exists yet to rehearse against — schema-only check.';
  else
    select id into v_group from acct_products where company_id = v_co and is_group limit 1;
    select id into v_cc from acct_cost_centers where company_id = v_co limit 1;
    if v_group is not null and v_cc is not null then
      update acct_products set cost_center_id = v_cc where id = v_group;
      select cost_center_id into v_read from acct_products where id = v_group;
      if v_read is distinct from v_cc then
        raise exception 'cost_center_id did not round-trip on acct_products';
      end if;
      update acct_products set cost_center_id = null where id = v_group;
    end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_name = 'acct_products' and column_name = 'cost_center_id')
  then raise exception 'acct_products.cost_center_id missing'; end if;
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'accounts' and column_name = 'cost_center_id')
  then raise exception 'accounts.cost_center_id missing'; end if;
end $chk$;
