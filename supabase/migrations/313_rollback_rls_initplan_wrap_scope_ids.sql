-- ROLLBACK for 313_rls_initplan_wrap_scope_ids.sql.
--
-- Restores all four policies to the state migration 312 left them in, which is
-- what production carries today: `auth_company_id()` and `is_staff()` hoisted
-- into `(select ...)`, `staff_scope_ids()` called bare. Captured from the live
-- production catalog on 2026-09-10 and verified byte-identical after a
-- rolled-back rehearsal on staging.
--
-- WITH CHECK is written out again unchanged, exactly as it appears above, so
-- that running this leaves all four policies in the same text they had before
-- 313 — not merely equivalent to it.
--
-- To go all the way back to the PRE-312 text instead, run
-- 312_rollback_rls_initplan_wrap.sql, which restores from the originals 312
-- captured and covers these four policies as well.

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

alter policy acct_cost_centers_staff on public.acct_cost_centers
  using (((company_id = (select auth_company_id())) and (select is_staff())
          and ((staff_scope_ids('cost_center'::text) is null)
               or (id = any (staff_scope_ids('cost_center'::text))))))
  with check (((company_id = (select auth_company_id())) and (select is_staff())));

alter policy acct_tag_areas_staff on public.acct_tag_areas
  using (((company_id = (select auth_company_id())) and (select is_staff())
          and ((staff_scope_ids('tag_area'::text) is null)
               or (id = any (staff_scope_ids('tag_area'::text))))))
  with check (((company_id = (select auth_company_id())) and (select is_staff())));

-- Post-condition: none of the four may still be hoisted, and WITH CHECK must be
-- untouched. A rollback that only partly rolled back is worse than none.
do $$
declare n_using int; n_check int;
begin
  select count(*) into n_using from pg_policy p
   where p.polname in ('accounts_staff','acct_products_staff',
                       'acct_cost_centers_staff','acct_tag_areas_staff')
     and pg_get_expr(p.polqual, p.polrelid) like '%( SELECT staff_scope_ids%';
  if n_using <> 0 then
    raise exception '313 rollback: % policies still carry a hoisted staff_scope_ids', n_using;
  end if;

  select count(*) into n_check from pg_policy p
   where p.polname in ('accounts_staff','acct_products_staff',
                       'acct_cost_centers_staff','acct_tag_areas_staff')
     and pg_get_expr(p.polwithcheck, p.polrelid) =
         '((company_id = ( SELECT auth_company_id() AS auth_company_id)) AND ( SELECT is_staff() AS is_staff))';
  if n_check <> 4 then
    raise exception '313 rollback: WITH CHECK altered on % of 4 policies - expected 0', 4 - n_check;
  end if;
end $$;

commit;
