-- 270_account_code_no_truncate.sql
-- The same lpad truncation fixed in 269 for document numbers also sits in the
-- chart-of-accounts code generators:
--
--   acct_create / acct_ensure_group / acct_ensure_named
--       v_code := p_root || '-' || lpad(coalesce(v_seq,1)::text, 2, '0')
--   ensure_party_account / ensure_salesperson_account / ensure_transport_vendor_account
--       v_code := par.code  || '-' || lpad(coalesce(v_seq,1)::text, 3, '0')
--
-- lpad shortens rather than widens, so the 100th account under a root would be
-- coded '-00' again (lpad('100',2,'0') = '10' — in fact '10'), and the 1000th
-- party ledger likewise, colliding with an existing code. Not urgent — the
-- busiest root currently holds 7 of 99 and the busiest party group 35 of 999 —
-- but it is the same defect and it fails confusingly now that codes are hidden
-- in the UI.
--
-- Patched by substituting the exact expression in each live definition rather
-- than restating six function bodies, so nothing else about them can drift.
-- Re-running finds nothing to replace, so this is idempotent.
do $mig$
declare r record; newdef text; n int := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in ('acct_create','acct_ensure_group','acct_ensure_named',
                        'ensure_party_account','ensure_salesperson_account',
                        'ensure_transport_vendor_account')
  loop
    newdef := replace(r.def,
      'lpad(coalesce(v_seq,1)::text, 2, ''0'')',
      'lpad(coalesce(v_seq,1)::text, greatest(2, length(coalesce(v_seq,1)::text)), ''0'')');
    newdef := replace(newdef,
      'lpad(coalesce(v_seq,1)::text, 3, ''0'')',
      'lpad(coalesce(v_seq,1)::text, greatest(3, length(coalesce(v_seq,1)::text)), ''0'')');
    if newdef <> r.def then
      execute newdef;
      n := n + 1;
    end if;
  end loop;
  raise notice 'account-code generators widened: %', n;
end $mig$;
