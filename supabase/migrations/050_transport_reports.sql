-- ============================================================
-- VISTA ERP - 050 Transport reporting
-- Applied to remote DB via Supabase MCP; kept here for history.
-- transport_reports(p_from date, p_to date) -> jsonb with every report dataset:
--   summary (bookings, trips, revenue, completed, cancelled),
--   by_agent, by_route, by_vehicle, by_driver, daily, cancelled_trips.
-- Bookings/revenue keyed by booking_date (fallback created_at); trip
-- breakdowns keyed by trip_date. Staff-guarded. See DB for the body (MCP 050).
-- ============================================================
select 1;
