-- ============================================================
-- VISTA ERP - 017 Automatic Madinah-night optimization
-- Removes manual Madinah-night selection. Auto Allocate now:
--  * tries every night as the single Madinah night,
--  * keeps the feasible plan using the FEWEST BRNs (least fragmentation),
--  * falls back to complete Makkah only if no Madinah night is feasible,
--  * guarantees every required night is covered exactly once.
-- Allocation stay dates come from brn_consumption (the actual allocated
-- portion), not the BRN agreement validity dates.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'brn_plan_row') then
    create type brn_plan_row as (brn_id uuid, night date, beds int);
  end if;
end $$;

-- Simulate a plan for a given Madinah night (null = all-Makkah).
create or replace function sim_plan(p_group uuid, p_mad date)
returns table(feasible boolean, runs int, plan brn_plan_row[])
language plpgsql security definer set search_path = public as $$
declare
  grp umrah_groups%rowtype; n date; seg text; need int; rec record; take int;
  v_plan brn_plan_row[] := '{}'; used_partial int; av int; r int;
begin
  select * into grp from umrah_groups where id = p_group;
  for n in select d::date from generate_series(grp.arrival_date, grp.departure_date - interval '1 day', interval '1 day') d loop
    if p_mad is not null and n = p_mad then seg := 'Madinah'; else seg := 'Makkah'; end if;
    need := grp.pax;
    for rec in
      select inv.id as id, inv.beds as beds,
        coalesce((select sum(c.beds) from brn_consumption c where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0) as used_committed
      from brn_inventory inv
      where inv.company_id = grp.company_id and inv.city = seg
        and inv.check_in <= n and inv.check_out > n
      order by
        (exists (select 1 from unnest(v_plan) p where p.brn_id = inv.id and p.night = n - 1)) desc,
        (inv.beds - coalesce((select sum(c.beds) from brn_consumption c where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)) desc
    loop
      exit when need <= 0;
      select coalesce(sum(p.beds), 0) into used_partial from unnest(v_plan) p where p.brn_id = rec.id and p.night = n;
      av := rec.beds - rec.used_committed - used_partial;
      if av <= 0 then continue; end if;
      take := least(need, av);
      v_plan := v_plan || row(rec.id, n, take)::brn_plan_row;
      need := need - take;
    end loop;
    if need > 0 then feasible := false; runs := null; plan := null; return next; return; end if;
  end loop;
  select count(*) into r from (
    select brn_id, beds, island from (
      select p.brn_id, p.beds, p.night,
             p.night - (dense_rank() over (partition by p.brn_id, p.beds order by p.night))::int as island
      from unnest(v_plan) p
    ) x group by brn_id, beds, island
  ) y;
  feasible := true; runs := r; plan := v_plan; return next;
end $$;
revoke all on function sim_plan(uuid, date) from anon, public;

drop function if exists allocate_group_brns(uuid, date);
drop function if exists allocate_group_brns(uuid);

create or replace function allocate_group_brns(p_group uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  grp umrah_groups%rowtype; c date; n date; res record;
  best_runs int; best_plan brn_plan_row[]; has_best boolean := false;
  rec record; run record; v_cons uuid; v_mad_avail int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into grp from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if grp.visa_status = 'issued' then raise exception 'Visa already issued — reopen the group to change allocation'; end if;
  if grp.brn_status = 'allocated' then raise exception 'Group % already has BRNs allocated', grp.group_no; end if;

  best_runs := null;
  for c in select d::date from generate_series(grp.arrival_date, grp.departure_date - interval '1 day', interval '1 day') d loop
    select coalesce(sum(inv.beds - coalesce((
              select sum(cc.beds) from brn_consumption cc
              where cc.brn_id = inv.id and cc.check_in <= c and cc.check_out > c), 0)), 0)
      into v_mad_avail
    from brn_inventory inv
    where inv.company_id = grp.company_id and inv.city = 'Madinah'
      and inv.check_in <= c and inv.check_out > c;
    if v_mad_avail < grp.pax then continue; end if;

    select * into res from sim_plan(p_group, c);
    if res.feasible then
      if best_runs is null or res.runs < best_runs then
        best_runs := res.runs; best_plan := res.plan; has_best := true;
      end if;
    end if;
  end loop;

  if not has_best then
    select * into res from sim_plan(p_group, null);
    if not res.feasible then
      for n in select d::date from generate_series(grp.arrival_date, grp.departure_date - interval '1 day', interval '1 day') d loop
        if (select coalesce(sum(inv.beds - coalesce((
                     select sum(cc.beds) from brn_consumption cc
                     where cc.brn_id = inv.id and cc.check_in <= n and cc.check_out > n), 0)), 0)
            from brn_inventory inv
            where inv.company_id = grp.company_id and inv.city = 'Makkah'
              and inv.check_in <= n and inv.check_out > n) < grp.pax then
          raise exception 'Insufficient inventory: cannot cover % for group %', to_char(n, 'DD Mon YYYY'), grp.group_no;
        end if;
      end loop;
      raise exception 'Insufficient inventory to cover the full stay for group %', grp.group_no;
    end if;
    best_plan := res.plan;
  end if;

  for rec in select distinct brn_id from unnest(best_plan) loop
    for run in
      select min(night) as s, max(night) as e, beds
      from (select night, beds, night - (dense_rank() over (partition by beds order by night))::int as island
            from unnest(best_plan) where brn_id = rec.brn_id) x
      group by beds, island order by 1
    loop
      v_cons := consume_brn(rec.brn_id, run.s, run.e + 1, run.beds, grp.group_no, 'Auto-allocated');
      insert into group_brn_allocation(company_id, group_id, brn_id, consumption_id, beds)
      values (grp.company_id, p_group, rec.brn_id, v_cons, run.beds);
    end loop;
  end loop;

  update umrah_groups set brn_status = 'allocated' where id = p_group;
  return grp.pax;
end $$;
revoke all on function allocate_group_brns(uuid) from anon, public;
grant execute on function allocate_group_brns(uuid) to authenticated;
