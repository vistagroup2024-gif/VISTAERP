-- 292 "revoke from anon" was not revoking anything.
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and anon is a member
-- of PUBLIC — so `revoke all on function ... from anon`, which this project's
-- migrations write after each staff-only routine, takes away a grant that was
-- never the one letting anon in. Checked as the anon role: dashboard_metrics()
-- and transport_rate_chart_parties() both ran, and mark_package_updated_manual()
-- reached its own body and was turned away by its is_staff() check rather than
-- by any grant.
--
-- Nothing leaked. The invoker functions come back empty because row-level
-- security has no company for an anon caller, and every definer one starts with
-- is_staff() or an equivalent. But a definer routine an unauthenticated caller
-- can enter at all is one gate away from trouble, and a line that reads like a
-- gate should be one.
--
-- This closes the staff-only routines written across this run. None of them is
-- reached from the agent, vendor or driver portals or the public voucher links,
-- which are anon by design and stay as they are.
do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname in (
      'brn_shortfall',
      'dashboard_metrics', 'dashboard_module_metrics', 'staff_dashboard_cards',
      'transport_rate_chart_parties', 'transport_agent_rate_chart',
      'mark_package_updated_manual',
      'staff_perm_strict', 'staff_admin_guard', 'staff_scope_masters',
      'staff_doc_key', 'staff_require_doc', 'staff_require_trade_right',
      'staff_require_journal_right', 'staff_require_scope_accounts',
      'staff_require_scope_products',
      'acct_voucher_guard', 'invoice_bill_save')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
    n := n + 1;
  end loop;
  raise notice 'closed % function(s) to anon', n;
end $$;
