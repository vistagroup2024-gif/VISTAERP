-- 293 Closing the rest of the database to anon, one function at a time.
--
-- 292 closed the routines written in that run. This is the sweep over everything
-- else, and it turned up something worse than a cosmetic revoke.
--
-- ── What was actually open ──────────────────────────────────────────────────
--
-- Fourteen internal engines had a DIRECT anon grant. Not through PUBLIC — a real
-- `grant execute ... to anon` somebody wrote. They are the routines that are
-- deliberately NOT granted to `authenticated`, precisely so the post-on-save gate
-- cannot be walked around (see CLAUDE.md). Granting them to anon hands out the
-- same thing to somebody who has not even logged in.
--
-- Measured as the anon role, on this database:
--
--   trade_doc_post_now   reached its body, refused by its own "Not authorized"
--   payroll_post_now     reached its body, refused by its own "Not authorized"
--   stock_apply          reached its body and got as far as a NOT NULL violation
--                        on stock_balances.warehouse_id — it was inserting. With
--                        a real warehouse id it would have moved stock.
--   acct_hold_document   reached its body and got a foreign-key violation on
--                        pending_vouchers — it was inserting a pending voucher.
--   car_post_contract    ran to completion. No error, no gate.
--
-- The anon key ships in the browser bundle by design, so "anon" means anybody.
--
-- ── What this does ──────────────────────────────────────────────────────────
--
-- Revokes PUBLIC and anon from every function except the ones that are anon BY
-- DESIGN, and grants nothing new: every routine the ERP calls already holds a
-- direct `authenticated` grant, and the fourteen engines above deliberately hold
-- none — so this restores the documented property instead of weakening it.
--
-- The keep-list is derived from the code, not from a name pattern: every rpc()
-- call reachable without a Supabase session. Trigger functions are left alone —
-- PostgREST does not expose them, and a trigger fires regardless of EXECUTE.
do $$
declare f record; n_closed int := 0; n_kept int := 0;
begin
  for f in
    select p.oid::regprocedure::text as sig, p.proname,
           (p.proname like 'b2b\_%' or p.proname in (
              -- portal logins and sessions (token-gated, no Supabase session)
              'login_b2b', 'login_vendor', 'login_driver', 'login_transport',
              'logout_b2b', 'logout_vendor', 'logout_transport',
              'vendor_of', 'vendor_trips', 'vendor_accept_trip',
              'transport_session_of', 'transport_me',
              'transport_driver_my_trips', 'transport_driver_portal_status',
              'transport_vendor_my_trips',
              -- public voucher links (/v/<token>, /hv/<token>)
              'public_transport_voucher', 'public_hotel_voucher',
              -- the cron endpoints, which run with no session and their own secret
              'car_monthly_run', 'generate_hotel_reminders', 'generate_tafweej_reminders',
              'generate_hotel_hcn_reminders', 'refresh_brn_availability',
              -- the push dispatcher, gated by p_secret
              'push_dispatch_targets', 'push_mark_notified', 'push_prune')
           ) as keep
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('public', p.oid, 'EXECUTE'))
  loop
    if f.keep then
      n_kept := n_kept + 1;
    else
      execute format('revoke all on function %s from public, anon', f.sig);
      n_closed := n_closed + 1;
    end if;
  end loop;
  raise notice 'closed % function(s) to anon, kept % anon-by-design', n_closed, n_kept;
end $$;
