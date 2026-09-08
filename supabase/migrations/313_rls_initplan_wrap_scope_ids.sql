-- PHASE 1C, follow-up: the last helper still called per row.
--
-- 312 wrapped `is_staff()` and `auth_company_id()`. That leaves
-- `staff_scope_ids('account')` and `staff_scope_ids('product')`, which the
-- Restrictions feature puts in the policies on `accounts` and `acct_products` —
-- and the policy calls each one TWICE per row, once to test for NULL and once to
-- test membership.
--
-- For an admin that is nearly free: staff_scope_ids returns NULL on its first
-- line. For a RESTRICTED user it runs a recursive descent of the master tree,
-- per row, twice — so the restriction meant to show somebody LESS is what makes
-- their screens slow. Measured on the staging replica, after 312:
--
--     restricted user, accounts scan   316.1 ms  ->  1.3 ms
--     restricted user, acct_tree()     274.9 ms  ->  4.8 ms
--
-- and the restricted user still saw exactly the 10 accounts they are scoped to,
-- the other tenant still saw only their own 20, and a blocked user still saw
-- none.
--
-- The cast is load-bearing. `ANY (select ...)` parses as the SUBQUERY form of
-- ANY, which compares against a set of rows; `ANY ((select ...)::uuid[])` keeps
-- the ARRAY form the original used. Without the cast Postgres rejects it
-- outright ("operator does not exist: uuid = uuid[]"), so this cannot be got
-- wrong silently.
--
-- Reversible: 313_rollback restores the two expressions 312 left in place.

begin;

alter policy accounts_staff on public.accounts
  using (((company_id = (select auth_company_id())) and (select is_staff())
          and (((select staff_scope_ids('account'::text)) is null)
               or (id = any ((select staff_scope_ids('account'::text))::uuid[])))))
  with check (((company_id = (select auth_company_id())) and (select is_staff())));

alter policy acct_products_staff on public.acct_products
  using (((company_id = (select auth_company_id())) and (select is_staff())
          and (((select staff_scope_ids('product'::text)) is null)
               or (id = any ((select staff_scope_ids('product'::text))::uuid[])))))
  with check (((company_id = (select auth_company_id())) and (select is_staff())));

commit;
