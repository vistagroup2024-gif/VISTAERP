-- Rollback of 369 — drops master_reorder.
--
-- Nothing to undo in the data: 369 added one routine and wrote no rows. Any
-- `sort` values a user has since set by pressing the arrows STAY, and that is
-- deliberate — they are the order somebody chose, and the screens read `sort`
-- whether or not this routine exists. Dropping it removes the ability to
-- change that order, not the order itself.
--
-- The arrow buttons on Product Tree, Cost Center and Tag Area will error if
-- they are still deployed, so drop this only alongside the matching UI.

begin;

drop function if exists public.master_reorder(text, uuid, text);

do $chk$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'master_reorder') then
    raise exception '369 rollback: master_reorder is still there';
  end if;
  raise notice '369 rollback ok';
end
$chk$;

commit;
