-- ROLLBACK for 312_rls_initplan_wrap.sql.
--
-- Restores every policy's expression to the byte-exact text 312 found before it
-- changed anything — read back from `_rls_policy_backup_312`, not re-derived by
-- reversing a regex. If that table is missing, 312 was never applied and there
-- is nothing to undo.
--
-- Policy names, commands and role lists were never altered, so nothing else has
-- to be put back.

begin;

do $restore$
declare r record; stmt text; n int := 0;
begin
  if to_regclass('public._rls_policy_backup_312') is null then
    raise exception 'Nothing to roll back: _rls_policy_backup_312 does not exist.';
  end if;

  for r in select * from public._rls_policy_backup_312 order by tbl, polname loop
    -- Skip a policy that has since been dropped rather than failing the whole
    -- rollback part-way through.
    if not exists (
      select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relnamespace = 'public'::regnamespace
        and c.relname = r.tbl and p.polname = r.polname)
    then
      raise notice 'Skipping %.% — policy no longer exists', r.tbl, r.polname;
      continue;
    end if;

    stmt := format('alter policy %I on public.%I', r.polname, r.tbl);
    if r.qual      is not null then stmt := stmt || format(' using (%s)', r.qual); end if;
    if r.withcheck is not null then stmt := stmt || format(' with check (%s)', r.withcheck); end if;
    execute stmt;
    n := n + 1;
  end loop;
  raise notice 'Phase 1C rollback: restored % policies', n;
end $restore$;

commit;

-- The backup table is deliberately left in place, so the rollback can be re-run
-- and so the original text stays on record. Drop it only once 312 is settled:
--   drop table public._rls_policy_backup_312;
