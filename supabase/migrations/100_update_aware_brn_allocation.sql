-- ============================================================
-- VISTA ERP - 100 Update-aware BRN allocation
-- When allocating a NEW group, the per-night BRN choice now considers pending
-- package-update groups (package_status = 'update_required') competing for the
-- SAME BRN pool (company_id + group_company_id). For each night it prefers a
-- BRN that STILL leaves the pool able to seat every pending update group's
-- uncovered demand that night (single-BRN-per-group). If no BRN can satisfy
-- both, the new group wins (new groups are priority). Pools with no pending
-- updates behave exactly as before (plain best-fit).
--
-- Note: reservation is evaluated per-night (is a big-enough BRN still available
-- for each update group on that night), not as a full joint multi-group solve.
-- This prevents the main loss case — a small new group consuming the only BRN
-- large enough for a waiting update group — without the cost/risk of a full
-- global optimiser. Segment (Makkah/Madinah) of an update group's uncovered
-- night is not known precisely, so demand is reserved conservatively against
-- the segment being allocated.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

-- Best-fit-decreasing feasibility: can every demand be seated, each whole in a
-- single bin (BRN), given these remaining capacities?
create or replace function public.brn_bestfit_fits(p_caps numeric[], p_demands numeric[])
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare bins numeric[]; dsorted numeric[]; d numeric; i int; bi int; bcap numeric;
begin
  bins := coalesce(p_caps, '{}');
  select coalesce(array_agg(x order by x desc), '{}') into dsorted from unnest(coalesce(p_demands,'{}')) x;
  foreach d in array dsorted loop
    bi := 0; bcap := null;
    for i in 1 .. coalesce(array_length(bins,1), 0) loop
      if bins[i] >= d and (bcap is null or bins[i] < bcap) then bcap := bins[i]; bi := i; end if;
    end loop;
    if bi = 0 then return false; end if;      -- no single bin big enough
    bins[bi] := bins[bi] - d;
  end loop;
  return true;
end $$;

create or replace function public.sim_plan(p_group uuid, p_mad date, p_start date, p_end date)
returns table(feasible boolean, runs int, plan brn_plan_row[])
language plpgsql security definer set search_path to 'public' as $$
declare
  grp umrah_groups%rowtype; n date; seg text; r int;
  v_plan brn_plan_row[] := '{}';
  v_demands numeric[]; v_caps numeric[]; cand record; v_chosen uuid; v_fallback uuid;
begin
  select * into grp from umrah_groups where id = p_group;
  for n in select d::date from generate_series(p_start, p_end - interval '1 day', interval '1 day') d loop
    if p_mad is not null and n = p_mad then seg := 'Madinah'; else seg := 'Makkah'; end if;

    -- Uncovered demand of pending package-update groups sharing this BRN pool on
    -- night n (reserved so a new allocation doesn't cannibalise their capacity).
    select coalesce(array_agg(u.pax order by u.pax desc), '{}') into v_demands
    from umrah_groups u
    where u.package_status = 'update_required' and u.id <> grp.id
      and u.company_id = grp.company_id
      and u.group_company_id is not distinct from grp.group_company_id
      and n >= u.arrival_date and n < u.departure_date
      and not (u.covered_from is not null and u.covered_to is not null
               and n >= u.covered_from and n < u.covered_to);

    v_chosen := null; v_fallback := null;
    for cand in
      select inv.id,
        (inv.beds - coalesce((select sum(c.beds) from brn_consumption c
             where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)) as free
      from brn_inventory inv
      where inv.company_id = grp.company_id and inv.city = seg
        and inv.group_company_id is not distinct from grp.group_company_id
        and inv.check_in <= n and inv.check_out > n
        and (inv.beds - coalesce((select sum(c.beds) from brn_consumption c
             where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)) >= grp.pax
      order by
        (exists (select 1 from unnest(v_plan) p where p.brn_id = inv.id and p.night = n - 1)) desc,
        (inv.beds - coalesce((select sum(c.beds) from brn_consumption c
             where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)) asc
    loop
      if v_fallback is null then v_fallback := cand.id; end if;         -- plain best-fit choice
      if array_length(v_demands, 1) is null then                       -- nothing to protect
        v_chosen := cand.id; exit;
      end if;
      -- Remaining pool capacities if we place the new group on this candidate.
      select coalesce(array_agg(rem), '{}') into v_caps from (
        select case when x.id = cand.id then x.free - grp.pax else x.free end as rem
        from (
          select inv.id,
            (inv.beds - coalesce((select sum(c.beds) from brn_consumption c
                 where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)) as free
          from brn_inventory inv
          where inv.company_id = grp.company_id and inv.city = seg
            and inv.group_company_id is not distinct from grp.group_company_id
            and inv.check_in <= n and inv.check_out > n
        ) x
      ) y where rem > 0;
      if brn_bestfit_fits(v_caps, v_demands) then                      -- leaves updates coverable
        v_chosen := cand.id; exit;
      end if;
    end loop;

    if v_chosen is null then v_chosen := v_fallback; end if;           -- new-group priority
    if v_chosen is null then feasible := false; runs := null; plan := null; return next; return; end if;
    v_plan := v_plan || row(v_chosen, n, grp.pax)::brn_plan_row;
  end loop;

  select count(*) into r from (
    select brn_id, island from (
      select p.brn_id, p.night, p.night - (dense_rank() over (partition by p.brn_id order by p.night))::int as island
      from unnest(v_plan) p) x group by brn_id, island) y;
  feasible := true; runs := r; plan := v_plan; return next;
end $$;
revoke all on function public.sim_plan(uuid, date, date, date) from anon, public;
