-- ============================================================
-- VISTA ERP - 047 Transport booking persistence RPCs
-- Applied to remote DB via Supabase MCP; kept here for history.
-- Atomic header + trips, auto booking number (TRP-000001), authoritative
-- pricing (sell -> net -> total), status workflow, delete. Staff-guarded.
-- See the database for the current function bodies (identical to the MCP
-- migration 047_transport_booking_save_rpcs).
-- ============================================================
create sequence if not exists transport_booking_seq;
-- transport_save_booking(p_id uuid, p_header jsonb, p_trips jsonb) returns uuid
-- transport_set_booking_status(p_id uuid, p_status text) returns void
-- delete_transport_booking(p_id uuid) returns void
select 1;
