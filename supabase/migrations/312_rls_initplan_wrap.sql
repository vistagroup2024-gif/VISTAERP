-- PHASE 1C — RLS: evaluate the permission helpers ONCE per query, not once per row.
--
-- WHAT IS WRONG
-- -------------
-- Every policy in this schema is written `company_id = auth_company_id() and
-- is_staff()`. Postgres cannot hoist a SECURITY DEFINER function out of a
-- security-barrier qual, so `is_staff()` is executed for EVERY row the scan
-- touches — and each call is two nested definer invocations that read `profiles`
-- and `user_roles`. Measured on the audit log: 3,869 rows scanned, 12,189 buffer
-- hits, 1,269 ms, to return 200 rows.
--
-- THE CHANGE
-- ----------
-- Wrap each call in a scalar sub-select. The planner then evaluates it as an
-- InitPlan: once, before the scan starts.
--
--     is_staff()          ->  (select is_staff())
--     auth_company_id()   ->  (select auth_company_id())
--
-- Nothing else moves. Both functions are STABLE and take no arguments, so
-- `(select f())` returns exactly what `f()` returned — this is a change to WHEN
-- the value is computed, not to WHAT it is. No permission is widened, narrowed
-- or reordered. The functions themselves are NOT touched. Neither is any
-- policy's name, command or role list: ALTER POLICY replaces only the expression.
--
-- Verified beforehand against the live catalog: of the 114 affected policies,
-- ZERO call either helper with a row-dependent argument and ZERO already have it
-- nested inside a sub-select, so the transform is uniform and safe.
--
-- MEASURED on a staging replica with production row counts (see 313 for the
-- optional follow-up):
--     brn_consumption count      283 ms -> 0.7 ms
--     audit log, 200 of 3,869  1,048 ms -> 1.1 ms
--     dashboard_module_metrics 1,784 ms -> 20 ms
--     groups list (368 rows)     299 ms -> 4.3 ms
-- and every persona — admin, staff, restricted staff, other tenant, blocked
-- user, unknown user, external agent — saw exactly the same rows, and the same
-- writes were refused, before and after.
--
-- REVERSIBILITY
-- -------------
-- The original expression of every policy is copied into
-- `_rls_policy_backup_312` BEFORE anything changes, so the rollback restores the
-- byte-exact text this migration found rather than a re-derived guess. Run
-- 312_rollback_rls_initplan_wrap.sql to undo.

begin;

-- 1. Keep the originals, exactly as they are now.
drop table if exists public._rls_policy_backup_312;
create table public._rls_policy_backup_312 (
  tbl         text not null,
  polname     text not null,
  qual        text,
  withcheck   text,
  captured_at timestamptz not null default now(),
  primary key (tbl, polname)
);
revoke all on public._rls_policy_backup_312 from public, anon, authenticated;

insert into public._rls_policy_backup_312 (tbl, polname, qual, withcheck)
select c.relname, p.polname,
       pg_get_expr(p.polqual, p.polrelid),
       pg_get_expr(p.polwithcheck, p.polrelid)
from pg_policy p
join pg_class c on c.oid = p.polrelid
where c.relnamespace = 'public'::regnamespace
  and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
       coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~* '\y(is_staff|auth_company_id)\(\)';

-- 2. Refuse to run if the schema is not the shape this migration was written for:
--    a helper called WITH an argument, or already inside a sub-select, would not
--    be safe to rewrite blindly.
do $guard$
declare n int;
begin
  select count(*) into n
  from public._rls_policy_backup_312
  where (coalesce(qual,'') || ' ' || coalesce(withcheck,'')) ~* '(is_staff|auth_company_id)\([^)]+\)';
  if n > 0 then
    raise exception 'Aborting: % policy/policies call a helper with an argument; review by hand.', n;
  end if;
end $guard$;

-- 3. Apply the wrap, one policy at a time, from the captured originals.
do $apply$
declare r record; nq text; nw text; stmt text; n int := 0;
begin
  for r in select * from public._rls_policy_backup_312 order by tbl, polname loop
    nq := r.qual;
    nw := r.withcheck;
    -- The negative lookbehind leaves anything already wrapped alone, so this
    -- migration is idempotent.
    if nq is not null then
      nq := regexp_replace(nq, '(?<!select )\yis_staff\(\)',        '(select is_staff())',        'gi');
      nq := regexp_replace(nq, '(?<!select )\yauth_company_id\(\)', '(select auth_company_id())', 'gi');
    end if;
    if nw is not null then
      nw := regexp_replace(nw, '(?<!select )\yis_staff\(\)',        '(select is_staff())',        'gi');
      nw := regexp_replace(nw, '(?<!select )\yauth_company_id\(\)', '(select auth_company_id())', 'gi');
    end if;

    stmt := format('alter policy %I on public.%I', r.polname, r.tbl);
    if nq is not null then stmt := stmt || format(' using (%s)', nq); end if;
    if nw is not null then stmt := stmt || format(' with check (%s)', nw); end if;
    execute stmt;
    n := n + 1;
  end loop;
  raise notice 'Phase 1C: rewrote % policies', n;
end $apply$;

-- 4. Nothing may be left calling either helper bare.
do $verify$
declare n int;
begin
  -- Case-INSENSITIVE on purpose: pg_get_expr renders the wrap back as
  -- "( SELECT is_staff() AS is_staff)" — uppercase keyword, and an alias. A
  -- case-sensitive lookbehind for 'select ' would not see that as wrapped and
  -- this check would abort a migration that had in fact worked.
  select count(*) into n
  from pg_policy p join pg_class c on c.oid = p.polrelid
  where c.relnamespace = 'public'::regnamespace
    and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
        ~* '(?<!select )\y(is_staff|auth_company_id)\(\)';
  if n > 0 then
    raise exception 'Aborting: % policy/policies still call a helper per row.', n;
  end if;
end $verify$;

commit;

-- After applying, this should show the InitPlan nodes and a per-row Filter that
-- is now a pre-computed value:
--   explain (analyze, buffers) select count(*) from brn_consumption;
