-- ============================================================
-- VISTA ERP - 028 True per-night coverage + Nusuk update workflow
-- Fixes: package status was derived from BRN min/max range, so a middle gap
-- could still read as Complete. Now validated night-by-night.
--
-- New status flow: complete -> update_required -> update_ready -> updated
--   * complete       : fresh allocation covers the full stay
--   * update_required: one or more required nights uncovered
--   * update_ready   : every night covered, but Nusuk not yet updated
--   * updated        : operator confirmed the Nusuk update (Mark Package Updated)
--
-- Applied to remote DB via Supabase MCP; kept here for history. Functions:
--   group_fully_covered(uuid)                -- every night covered exactly once
--   recompute_group_coverage(uuid, text)     -- 'fresh' => complete, else update_ready
--   allocate_group_brns / update_package_brns / remove_group_brn /
--   reallocate_group_brn / reallocate_all_brns  -> all recompute via true coverage
--   mark_package_updated(uuid)               -- blocked unless fully covered
--   list_replacement_brns(uuid) / replace_group_brn(uuid,uuid)  -- manual city swap
-- ============================================================

create or replace function group_fully_covered(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with g as (select * from umrah_groups where id = p_group),
  nights as (
    select d::date as night from g, generate_series(g.arrival_date, g.departure_date - interval '1 day', interval '1 day') d
  ),
  cov as (
    select n.night, count(c.id) as cnt
    from nights n
    left join group_brn_allocation ga on ga.group_id = p_group
    left join brn_consumption c on c.id = ga.consumption_id and c.check_in <= n.night and c.check_out > n.night
    group by n.night
  )
  select coalesce((select bool_and(cnt = 1) from cov), false);
$$;
revoke all on function group_fully_covered(uuid) from anon, public;
grant execute on function group_fully_covered(uuid) to authenticated;

-- Old single-arg recompute removed in favour of recompute_group_coverage(uuid, text).
drop function if exists recompute_group_coverage(uuid);

-- (recompute_group_coverage, allocate_group_brns, update_package_brns,
--  mark_package_updated, list_replacement_brns, replace_group_brn full bodies
--  applied via MCP — see the database for current definitions.)
select 1;
