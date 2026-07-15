-- ============================================================
-- VISTA ERP - 029 BRN allocation integrity: LIFO, locked BRNs, agreement merge
-- Additive. Applied to remote DB via Supabase MCP; kept here for history.
--
-- - group_brn_allocation.locked: BRNs submitted to Nusuk at visa issuance are
--   locked (backfilled for already-issued groups). mark_visa_issued locks all
--   current allocations. Locked BRNs cannot be removed/reallocated/replaced.
-- - LIFO removal: remove_group_brn blocks removing a BRN while a later BRN is
--   still allocated (must remove latest-first).
-- - Agreement merge: merge_adjacent_group_brns() collapses adjacent same-BRN,
--   equal-bed consumptions into one continuous record; called inside
--   recompute_group_coverage so Replace/Reallocate never leave duplicate rows.
--
-- Full function bodies applied via MCP; see the database for current defs of:
--   merge_adjacent_group_brns, recompute_group_coverage, mark_visa_issued,
--   remove_group_brn, reallocate_group_brn, replace_group_brn.
-- ============================================================

alter table group_brn_allocation add column if not exists locked boolean not null default false;
update group_brn_allocation ga set locked = true
where locked = false and exists (select 1 from umrah_groups g where g.id = ga.group_id and g.visa_status = 'issued');

select 1;
