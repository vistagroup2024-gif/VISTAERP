-- PHASE 1C, follow-up: the last helper still called once per row.
--
-- 312 wrapped `is_staff()` and `auth_company_id()` so Postgres evaluates them
-- once per query instead of once per row. It left `staff_scope_ids()` bare, and
-- that is the one the Restrictions feature puts in the policies on the four
-- master tables — where the policy calls it TWICE per row, once to test for
-- NULL and once to test membership.
--
-- WHO THIS HELPS: everybody. The first draft of this migration claimed the cost
-- was "nearly free for an admin". That is wrong, and measuring it is what showed
-- it. `staff_scope_ids` returns NULL early for an admin, but only after calling
-- `has_role('admin')`, which queries `user_roles` — so an admin still pays two
-- of those lookups per row. An unrestricted non-admin pays more again: it gets
-- past has_role and queries `staff_scopes` before it can return NULL. Measured
-- on the staging replica against production's current policy text:
--
--     restricted   accounts fetch    274.80 ms  ->   1.28 ms   (-100%)
--     restricted   acct_tree()       279.46 ms  ->   4.78 ms    (-98%)
--     normal staff accounts fetch     12.19 ms  ->   0.61 ms    (-95%)
--     normal staff acct_tree()       105.64 ms  ->  14.71 ms    (-86%)
--     admin        accounts fetch      7.24 ms  ->   0.61 ms    (-92%)
--     admin        acct_tree()        99.47 ms  ->  14.72 ms    (-85%)
--
-- A restriction is what makes the difference largest, because the function then
-- does a recursive descent of the master tree rather than returning NULL — so
-- the setting meant to show somebody LESS is what made their screens slowest.
-- But the admin and the unrestricted user are not bystanders: the saving for
-- them is the per-row `has_role` / `staff_scopes` lookups, and it is most of
-- the cost of drawing the accounts tree.
--
-- WHAT CHANGES: nothing but where the call sits. `staff_scope_ids` itself is
-- untouched, the logic is identical, and WITH CHECK is left exactly as 312 left
-- it — this migration only affects which rows are READ, never which may be
-- written. Wrapping a STABLE function in `(select ...)` lets the planner hoist
-- it into an InitPlan, evaluated once for the whole query.
--
-- THE CAST IS LOAD-BEARING. `ANY (select ...)` parses as the SUBQUERY form of
-- ANY, which compares against a set of rows; `ANY ((select ...)::uuid[])` keeps
-- the ARRAY form the original used. `staff_scope_ids` returns uuid[], so the
-- cast changes no value — it only picks the parse. Without it Postgres refuses
-- the statement outright ("operator does not exist: uuid = uuid[]"), so this
-- cannot be got wrong silently.
--
-- ALL FOUR policies that call staff_scope_ids are done here. An earlier draft
-- did only `accounts` and `acct_products` and left `acct_cost_centers` and
-- `acct_tag_areas` bare — the same expression, the same cost, just on smaller
-- tables. Splitting them was the mistake; the four are one change.
--
-- Reversible: 313_rollback restores the exact text this migration replaces.

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

alter policy acct_cost_centers_staff on public.acct_cost_centers
  using (((company_id = (select auth_company_id())) and (select is_staff())
          and (((select staff_scope_ids('cost_center'::text)) is null)
               or (id = any ((select staff_scope_ids('cost_center'::text))::uuid[])))))
  with check (((company_id = (select auth_company_id())) and (select is_staff())));

alter policy acct_tag_areas_staff on public.acct_tag_areas
  using (((company_id = (select auth_company_id())) and (select is_staff())
          and (((select staff_scope_ids('tag_area'::text)) is null)
               or (id = any ((select staff_scope_ids('tag_area'::text))::uuid[])))))
  with check (((company_id = (select auth_company_id())) and (select is_staff())));

-- Post-condition. If any of the four did not end up hoisted, or a WITH CHECK
-- moved, the transaction fails rather than half-applying: a policy is the gate
-- on who reads what, so "mostly applied" is not a state to leave it in.
do $$
declare n_using int; n_check int;
begin
  select count(*) into n_using from pg_policy p
   where p.polname in ('accounts_staff','acct_products_staff',
                       'acct_cost_centers_staff','acct_tag_areas_staff')
     and pg_get_expr(p.polqual, p.polrelid) like '%( SELECT staff_scope_ids%';
  if n_using <> 4 then
    raise exception '313: expected 4 policies with a hoisted staff_scope_ids, found %', n_using;
  end if;

  select count(*) into n_check from pg_policy p
   where p.polname in ('accounts_staff','acct_products_staff',
                       'acct_cost_centers_staff','acct_tag_areas_staff')
     and pg_get_expr(p.polwithcheck, p.polrelid) =
         '((company_id = ( SELECT auth_company_id() AS auth_company_id)) AND ( SELECT is_staff() AS is_staff))';
  if n_check <> 4 then
    raise exception '313: WITH CHECK altered on % of 4 policies - expected 0', 4 - n_check;
  end if;
end $$;

commit;
