-- ============================================================
-- VISTA ERP - 023 One BRN per night allocation rule
-- Each night must be fully covered by a SINGLE BRN with enough beds.
-- A night can no longer be split across multiple BRNs. Best-fit BRN
-- (smallest sufficient), preferring the previous night's BRN for continuity.
-- If no single BRN can seat the group on a night, allocation is blocked with
-- a purchase-required message.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

create or replace function sim_plan(p_group uuid, p_mad date)
returns table(feasible boolean, runs int, plan brn_plan_row[])
language plpgsql security definer set search_path = public as $$
declare
  grp umrah_groups%rowtype; n date; seg text; v_brn uuid;
  v_plan brn_plan_row[] := '{}'; r int;
begin
  select * into grp from umrah_groups where id = p_group;
  for n in select d::date from generate_series(grp.arrival_date, grp.departure_date - interval '1 day', interval '1 day') d loop
    if p_mad is not null and n = p_mad then seg := 'Madinah'; else seg := 'Makkah'; end if;
    select inv.id into v_brn
    from brn_inventory inv
    where inv.company_id = grp.company_id and inv.city = seg
      and inv.check_in <= n and inv.check_out > n
      and (inv.beds - coalesce((select sum(c.beds) from brn_consumption c
             where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)) >= grp.pax
    order by
      (exists (select 1 from unnest(v_plan) p where p.brn_id = inv.id and p.night = n - 1)) desc,
      (inv.beds - coalesce((select sum(c.beds) from brn_consumption c
             where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)) asc
    limit 1;
    if v_brn is null then feasible := false; runs := null; plan := null; return next; return; end if;
    v_plan := v_plan || row(v_brn, n, grp.pax)::brn_plan_row;
  end loop;
  select count(*) into r from (
    select brn_id, island from (
      select p.brn_id, p.night, p.night - (dense_rank() over (partition by p.brn_id order by p.night))::int as island
      from unnest(v_plan) p
    ) x group by brn_id, island
  ) y;
  feasible := true; runs := r; plan := v_plan; return next;
end $$;
revoke all on function sim_plan(uuid, date) from anon, public;

create or replace function allocate_group_brns(p_group uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  grp umrah_groups%rowtype; c date; n date; res record;
  best_runs int; best_plan brn_plan_row[]; has_best boolean := false;
  rec record; run record; v_cons uuid; v_mad_ok boolean;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into grp from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if grp.visa_status = 'issued' then raise exception 'Visa already issued — reopen the group to change allocation'; end if;
  if grp.brn_status = 'allocated' then raise exception 'Group % already has BRNs allocated', grp.group_no; end if;

  best_runs := null;
  for c in select d::date from generate_series(grp.arrival_date, grp.departure_date - interval '1 day', interval '1 day') d loop
    select exists (
      select 1 from brn_inventory inv
      where inv.company_id = grp.company_id and inv.city = 'Madinah'
        and inv.check_in <= c and inv.check_out > c
        and (inv.beds - coalesce((select sum(cc.beds) from brn_consumption cc
               where cc.brn_id = inv.id and cc.check_in <= c and cc.check_out > c), 0)) >= grp.pax
    ) into v_mad_ok;
    if not v_mad_ok then continue; end if;
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
        if not exists (
          select 1 from brn_inventory inv
          where inv.company_id = grp.company_id and inv.city = 'Makkah'
            and inv.check_in <= n and inv.check_out > n
            and (inv.beds - coalesce((select sum(cc.beds) from brn_consumption cc
                   where cc.brn_id = inv.id and cc.check_in <= n and cc.check_out > n), 0)) >= grp.pax
        ) then
          raise exception 'No single BRN has sufficient capacity for % beds on % (Makkah). Additional BRN inventory must be purchased.',
            grp.pax, to_char(n, 'DD Mon YYYY');
        end if;
      end loop;
      raise exception 'Allocation cannot continue because no single BRN has sufficient beds for a required night. Please purchase additional BRN inventory.';
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
