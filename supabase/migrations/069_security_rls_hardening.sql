-- 069_security_rls_hardening
-- Lock down the two objects that were reachable through PostgREST without RLS.
--
-- 1) hotel_reminder_sent — a dedup bookkeeping table written ONLY by SECURITY
--    DEFINER functions (generate_hotel_reminders and the delete-group release).
--    Definer functions bypass RLS, so enabling RLS with NO policies makes the
--    table deny-all for anon/authenticated while the cron keeps working. This is
--    the same intended-secure pattern used by the session/definer tables.
alter table public.hotel_reminder_sent enable row level security;
revoke all on public.hotel_reminder_sent from anon, authenticated;

-- 2) transport_trip_sched — already security_invoker=on (respects underlying
--    RLS). Drop the anon grant as defense-in-depth; only staff read it.
revoke all on public.transport_trip_sched from anon;
