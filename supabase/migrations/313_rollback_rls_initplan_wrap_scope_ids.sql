-- ROLLBACK for 313_rls_initplan_wrap_scope_ids.sql.
--
-- Puts the two policies back to the state 312 left them in: is_staff() and
-- auth_company_id() wrapped, staff_scope_ids() called bare as it is today.
-- To go all the way back to the current production text, run
-- 312_rollback_rls_initplan_wrap.sql instead (it restores from the captured
-- originals and covers these two policies as well).

begin;

alter policy accounts_staff on public.accounts
  using (((company_id = (select auth_company_id())) and (select is_staff())
          and ((staff_scope_ids('account'::text) is null)
               or (id = any (staff_scope_ids('account'::text))))))
  with check (((company_id = (select auth_company_id())) and (select is_staff())));

alter policy acct_products_staff on public.acct_products
  using (((company_id = (select auth_company_id())) and (select is_staff())
          and ((staff_scope_ids('product'::text) is null)
               or (id = any (staff_scope_ids('product'::text))))))
  with check (((company_id = (select auth_company_id())) and (select is_staff())));

commit;
