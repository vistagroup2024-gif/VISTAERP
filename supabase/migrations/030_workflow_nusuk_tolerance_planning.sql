-- ============================================================
-- VISTA ERP - 030 Staged visa workflow + Nusuk tolerance
-- Additive. Applied to remote DB via Supabase MCP; kept here for history.
--
-- 1. Nusuk tolerance: nusuk_complete() treats a contiguous allocation missing
--    only the first and/or last night as acceptable (no Package Update task).
--    recompute_group_coverage + mark_package_updated use it. Only genuine
--    internal gaps or under-coverage produce 'update_required'.
-- 2. Staged workflow: umrah_groups.workflow_status
--    (pending -> brn_allocated -> erp_created -> package_assigned -> visa_issued).
--    advance_workflow() for the middle stages; mark_visa_issued() requires
--    'package_assigned'; reopen_group() returns to 'package_assigned' + unlocks.
--    allocate/deallocate/reallocate_all keep workflow_status in sync.
-- 3. Purchase Planning demand includes pending package updates (uncovered
--    nights only) — handled in the app layer.
--
-- Full function bodies applied via MCP; see the database for current defs of:
--   nusuk_complete, recompute_group_coverage, mark_package_updated,
--   advance_workflow, mark_visa_issued, reopen_group, allocate_group_brns,
--   deallocate_group_brns, reallocate_all_brns.
-- ============================================================

alter table umrah_groups add column if not exists workflow_status text;
-- Backfill from existing brn/visa status (run with guard bypass for issued rows)
do $$ begin
  perform set_config('vista.bypass_guard','1',true);
  update umrah_groups set workflow_status = case
    when visa_status = 'issued' then 'visa_issued'
    when brn_status = 'allocated' then 'brn_allocated'
    else 'pending' end
  where workflow_status is null;
end $$;

select 1;
