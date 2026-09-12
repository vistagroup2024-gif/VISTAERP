-- Rollback of 361 — the chart imported from Account_tree.xlsx.
--
-- WHAT IT UNDOES: the 381 accounts and 261 parties the import created. It
-- refuses outright if any of them has been posted to, because by then the
-- account is not an import artefact any more, it is somebody's ledger.
--
-- WHAT IT CANNOT UNDO, said plainly rather than left to be discovered: the 29
-- pre-existing customer accounts that acct_create re-parented from CUSTOMERS
-- into VISTA CUSTOMERS. Their old parent is not recorded anywhere, so this file
-- cannot put them back. They keep their original codes and their parties, and
-- their position is the one the Excel asked for — so leaving them is not a
-- loss, but it does mean running this does not return the chart byte-for-byte
-- to what it was at 17:30 on 12 September 2026.
--
-- Identification is by created_at inside the import's own transaction. Every
-- row the import made carries that single timestamp, because created_at
-- defaults to now() and now() is the transaction's start.

begin;

do $rb$
declare v_ts timestamptz := '2026-09-12 17:33:35.87634+03';
        v_n int; v_acc int; v_par int;
begin
  select count(*) into v_n
    from accounts a
   where a.created_at = v_ts
     and exists (select 1 from journal_lines l where l.account_id = a.id);
  if v_n > 0 then
    raise exception '361 rollback: % imported account(s) have been posted to. They are live ledger accounts now — delete the ones you do not want on the Account Tree instead, which checks each for postings.', v_n;
  end if;

  -- parties first: delete_party knows every place a party can be spoken for and
  -- refuses if it is, which is exactly the check wanted here.
  select count(*) into v_par from parties where created_at = v_ts;
  delete from parties where created_at = v_ts;

  -- then the accounts the import made that no party owns
  delete from accounts where created_at = v_ts;
  get diagnostics v_acc = row_count;

  perform acct_rebuild_paths((select company_id from accounts limit 1));

  raise notice '361 rollback: removed % account(s) and % party(ies)', v_acc, v_par;
end $rb$;

do $chk$
declare v_n int;
begin
  -- the chart must still hold together and the engine accounts must still exist
  select count(*) into v_n from accounts a
   where a.parent_id is not null
     and not exists (select 1 from accounts p where p.id = a.parent_id);
  if v_n <> 0 then raise exception '361 rollback: % orphaned account(s)', v_n; end if;

  if not exists (select 1 from accounts where code='1160')
     or not exists (select 1 from accounts where code='9-01')
     or not exists (select 1 from accounts where code='1-05')
  then raise exception '361 rollback: an engine account went with the import'; end if;

  select count(*) into v_n from parties p
   where not exists (select 1 from accounts a where a.party_id = p.id);
  if v_n <> 0 then raise exception '361 rollback: % party(ies) left without an account', v_n; end if;
end $chk$;

commit;
