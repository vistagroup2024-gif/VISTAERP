-- ============================================================
-- VISTA ERP - 049 B2B agent white-label voucher branding
-- Applied to remote DB via Supabase MCP; kept here for history.
-- Optional per-agent branding so Vista branding never appears on an agent
-- voucher: logo (data URL or image URL), address, voucher_note.
-- ============================================================
alter table b2b_agents add column if not exists logo text;
alter table b2b_agents add column if not exists address text;
alter table b2b_agents add column if not exists voucher_note text;
