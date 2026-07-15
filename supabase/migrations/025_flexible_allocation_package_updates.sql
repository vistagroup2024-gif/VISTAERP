-- ============================================================
-- VISTA ERP - 025 Flexible BRN allocation + Package Update tracking
-- Additive only — existing behaviour (full-stay allocation) is Priority 1.
--
-- Allocation now tries, in order:
--   1. Full stay (Complete Package)
--   2. Missing first night (Nusuk: check-in +1 day)
--   3. Missing last night  (Nusuk: checkout -1 day)
--   4. Largest partial window >= 3 nights (special case)
-- Minimum 3 hotel nights enforced. Partial coverage sets package_status =
-- 'update_required' and records covered_from/covered_to so the Package Update
-- Management dashboard can track it.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

alter table umrah_groups add column if not exists package_status text;
alter table umrah_groups add column if not exists covered_from date;
alter table umrah_groups add column if not exists covered_to date;
update umrah_groups set package_status = 'complete' where brn_status = 'allocated' and package_status is null;

-- sim_plan over an explicit [p_start, p_end) window (single BRN per night, city + company scoped)
drop function if exists sim_plan(uuid, date);
create or replace function sim_plan(p_group uuid, p_mad date, p_start date, p_end date)
returns table(feasible boolean, runs int, plan brn_plan_row[])
language plpgsql security definer set search_path = public as $$
declare grp umrah_groups%rowtype; n date; seg text; v_brn uuid; v_plan brn_plan_row[] := '{}'; r int;
begin
  select * into grp from umrah_groups where id = p_group;
  for n in select d::date from generate_series(p_start, p_end - interval '1 day', interval '1 day') d loop
    if p_mad is not null and n = p_mad then seg := 'Madinah'; else seg := 'Makkah'; end if;
    select inv.id into v_brn from brn_inventory inv
    where inv.company_id = grp.company_id and inv.city = seg
      and inv.group_company_id is not distinct from grp.group_company_id
      and inv.check_in <= n and inv.check_out > n
      and (inv.beds - coalesce((select sum(c.beds) from brn_consumption c
             where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)) >= grp.pax
    order by (exists (select 1 from unnest(v_plan) p where p.brn_id = inv.id and p.night = n - 1)) desc,
      (inv.beds - coalesce((select sum(c.beds) from brn_consumption c
             where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)) asc
    limit 1;
    if v_brn is null then feasible := false; runs := null; plan := null; return next; return; end if;
    v_plan := v_plan || row(v_brn, n, grp.pax)::brn_plan_row;
  end loop;
  select count(*) into r from (
    select brn_id, island from (
      select p.brn_id, p.night, p.night - (dense_rank() over (partition by p.brn_id order by p.night))::int as island
      from unnest(v_plan) p) x group by brn_id, island) y;
  feasible := true; runs := r; plan := v_plan; return next;
end $$;
revoke all on function sim_plan(uuid, date, date, date) from anon, public;

create or replace function plan_window(p_group uuid, p_start date, p_end date)
returns table(feasible boolean, runs int, plan brn_plan_row[])
language plpgsql security definer set search_path = public as $$
declare grp umrah_groups%rowtype; c date; res record; best_runs int; best_plan brn_plan_row[]; has boolean := false; v_mad_ok boolean;
begin
  select * into grp from umrah_groups where id = p_group;
  best_runs := null;
  for c in select d::date from generate_series(p_start, p_end - interval '1 day', interval '1 day') d loop
    select exists (select 1 from brn_inventory inv
      where inv.company_id = grp.company_id and inv.city = 'Madinah'
        and inv.group_company_id is not distinct from grp.group_company_id
        and inv.check_in <= c and inv.check_out > c
        and (inv.beds - coalesce((select sum(cc.beds) from brn_consumption cc
               where cc.brn_id = inv.id and cc.check_in <= c and cc.check_out > c), 0)) >= grp.pax) into v_mad_ok;
    if not v_mad_ok then continue; end if;
    select * into res from sim_plan(p_group, c, p_start, p_end);
    if res.feasible and (best_runs is null or res.runs < best_runs) then best_runs := res.runs; best_plan := res.plan; has := true; end if;
  end loop;
  if not has then
    select * into res from sim_plan(p_group, null, p_start, p_end);
    if res.feasible then best_plan := res.plan; has := true; best_runs := res.runs; end if;
  end if;
  feasible := has; runs := best_runs; plan := best_plan; return next;
end $$;
revoke all on function plan_window(uuid, date, date) from anon, public;

-- allocate_group_brns, deallocate_group_brns, mark_package_updated:
-- full bodies applied via MCP (see functions in the database). Priority windows,
-- min-3-nights enforcement, package_status + covered_from/covered_to, and the
-- 'package_update_required' audit entry are implemented there.
