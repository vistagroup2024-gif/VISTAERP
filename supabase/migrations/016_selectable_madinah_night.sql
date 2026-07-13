-- ============================================================
-- VISTA ERP - 016 Selectable Madinah night
-- The single Madinah night can be any night of the stay (operator picks).
-- If Madinah can't cover the chosen night for the whole group, the entire
-- stay falls back to Makkah. Remaining nights are always Makkah.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

drop function if exists allocate_group_brns(uuid);

create or replace function allocate_group_brns(p_group uuid, p_madinah_night date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  grp umrah_groups%rowtype; n date; seg_city text; need integer;
  rec record; take integer; run record; v_cons uuid;
  v_mad_avail integer; v_mad_night date; v_use_madinah boolean;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into grp from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if grp.visa_status = 'issued' then raise exception 'Visa already issued — reopen the group to change allocation'; end if;
  if grp.brn_status = 'allocated' then raise exception 'Group % already has BRNs allocated', grp.group_no; end if;

  v_mad_night := coalesce(p_madinah_night, grp.arrival_date);
  if v_mad_night < grp.arrival_date or v_mad_night >= grp.departure_date then
    raise exception 'Selected Madinah night % is outside the stay (% to %)',
      v_mad_night, grp.arrival_date, grp.departure_date;
  end if;

  select coalesce(sum(inv.beds - coalesce((
            select sum(c.beds) from brn_consumption c
            where c.brn_id = inv.id and c.check_in <= v_mad_night and c.check_out > v_mad_night), 0)), 0)
    into v_mad_avail
  from brn_inventory inv
  where inv.company_id = grp.company_id and inv.city = 'Madinah'
    and inv.check_in <= v_mad_night and inv.check_out > v_mad_night;
  v_use_madinah := (v_mad_avail >= grp.pax);

  drop table if exists _alloc;
  create temp table _alloc(brn_id uuid, night date, beds int) on commit drop;

  for n in select d::date from generate_series(grp.arrival_date, grp.departure_date - interval '1 day', interval '1 day') d loop
    if v_use_madinah and n = v_mad_night then seg_city := 'Madinah'; else seg_city := 'Makkah'; end if;
    need := grp.pax;
    for rec in
      select inv.id,
        (inv.beds
          - coalesce((select sum(c.beds) from brn_consumption c where c.brn_id = inv.id and c.check_in <= n and c.check_out > n), 0)
          - coalesce((select sum(a.beds) from _alloc a where a.brn_id = inv.id and a.night = n), 0)) as avail,
        (select 1 from _alloc a2 where a2.brn_id = inv.id and a2.night = n - 1 limit 1) as active_prev
      from brn_inventory inv
      where inv.company_id = grp.company_id and inv.city = seg_city
        and inv.check_in <= n and inv.check_out > n
      order by active_prev desc nulls last, avail desc
    loop
      exit when need <= 0;
      if rec.avail is null or rec.avail <= 0 then continue; end if;
      take := least(need, rec.avail);
      insert into _alloc values (rec.id, n, take);
      need := need - take;
    end loop;
    if need > 0 then
      raise exception 'Insufficient % inventory on %: short by % bed(s) for group %',
        seg_city, to_char(n, 'DD Mon YYYY'), need, grp.group_no;
    end if;
  end loop;

  for rec in select distinct brn_id from _alloc loop
    for run in
      select min(night) as start_night, max(night) as end_night, beds
      from (select night, beds, night - (dense_rank() over (partition by beds order by night))::int as island
            from _alloc where brn_id = rec.brn_id) s
      group by beds, island order by 1
    loop
      v_cons := consume_brn(rec.brn_id, run.start_night, run.end_night + 1, run.beds, grp.group_no, 'Auto-allocated');
      insert into group_brn_allocation(company_id, group_id, brn_id, consumption_id, beds)
      values (grp.company_id, p_group, rec.brn_id, v_cons, run.beds);
    end loop;
  end loop;

  drop table if exists _alloc;
  update umrah_groups set brn_status = 'allocated' where id = p_group;
  return grp.pax;
end;
$$;

revoke all on function allocate_group_brns(uuid, date) from anon, public;
grant execute on function allocate_group_brns(uuid, date) to authenticated;
