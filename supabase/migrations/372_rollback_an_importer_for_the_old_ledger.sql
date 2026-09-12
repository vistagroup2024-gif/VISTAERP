-- Rollback of 372 — drops the ledger importer, and optionally unposts what it
-- loaded.
--
-- TWO SEPARATE THINGS, so read before running. Dropping the routine is
-- harmless. Removing the entries it imported is not: those are the company's
-- ledger history once they are in, and anything raised against them afterwards
-- would be left pointing at nothing.
--
-- So this only drops the ROUTINE, and REFUSES if imported entries are still
-- standing — because dropping the importer while its rows remain leaves nobody
-- able to explain where they came from. Clear them first, deliberately, with
-- the statement at the bottom of this file, once you are sure.

begin;

do $rb$
declare v_n int;
begin
  select count(*) into v_n from journal_entries where source = 'history_import';
  if v_n > 0 then
    raise exception '372 rollback: % imported entr(ies) are still in the ledger. Decide about those first — see the note at the foot of this file.', v_n;
  end if;
end
$rb$;

drop function if exists public.gl_history_import(jsonb, boolean);

do $chk$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'gl_history_import') then
    raise exception '372 rollback: the importer is still there';
  end if;
  raise notice '372 rollback ok';
end
$chk$;

commit;

-- ---------------------------------------------------------------------------
-- TO UNDO AN IMPORT ITSELF — not run by this file. Every row the importer wrote
-- carries source = 'history_import', which is what makes this exact:
--
--   begin;
--   delete from journal_lines where entry_id in (
--     select id from journal_entries where source = 'history_import');
--   delete from journal_entries where source = 'history_import';
--   -- then confirm before committing:
--   select count(*) as should_be_zero from journal_entries where source = 'history_import';
--   commit;
--
-- Narrow it with `and entry_date between ... and ...` or `and reference = ...`
-- to drop one batch rather than all of them. It does NOT touch anything the ERP
-- posted for itself: a car invoice's entry carries source 'car_sale', a trade
-- voucher's carries its own, and none of them is 'history_import'.
-- ---------------------------------------------------------------------------
