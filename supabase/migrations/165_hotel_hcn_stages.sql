-- 165 HCN workflow stages for the per-stay hotel confirmation flow (Phase 3).
--
-- Workflow per stay (hotel_purchase_bookings row):
--   Waiting HCN (pending) -> Received HCN, enter number (ready_to_send) -> HCN Sent (sent)
-- Existing values pending/received/shared are kept for back-compat.
--
-- Enum ADD VALUE must be committed before the value is used, so this is its own
-- migration, separate from the RPCs in 166.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

alter type hotel_hcn_status add value if not exists 'ready_to_send';
alter type hotel_hcn_status add value if not exists 'sent';
