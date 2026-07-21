-- ============================================================
-- VISTA ERP - 031 Masar visa (agent BRNs) + package-update availability
-- Additive. Applied to remote DB via Supabase MCP; kept here for history.
--
-- 1. umrah_groups.visa_type ('normal'|'masar'), agent_brn_pending.
--    add_agent_brn(): records an agent-provided BRN as a locked consumption for
--    the group (creates an inventory row consumed by the group). set_masar_option()
--    chooses 'vista' (Vista fills remaining) or 'later' (agent will provide more).
--    advance_workflow() blocks while agent_brn_pending.
-- 2. can_complete_update(): can a partial group's uncovered nights be filled from
--    current inventory? refresh_update_availability() flips
--    update_required <-> update_available accordingly (drives the
--    "Ready for Package Update" notification). update_package_brns accepts both.
-- 3. City-wise + Madinah-optimized purchase planning is computed in the app layer.
--
-- Full function bodies applied via MCP; see the database for current defs of:
--   add_agent_brn, set_masar_option, advance_workflow, can_complete_update,
--   refresh_update_availability, update_package_brns.
-- ============================================================

alter table umrah_groups add column if not exists visa_type text not null default 'normal';
alter table umrah_groups add column if not exists agent_brn_pending boolean not null default false;

select 1;
