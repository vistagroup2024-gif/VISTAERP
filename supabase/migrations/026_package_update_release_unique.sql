-- ============================================================
-- VISTA ERP - 026 Package-update auto-allocation, BRN release, unique group no
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

-- Group Number unique across the ERP
create unique index if not exists uq_umrah_group_no on umrah_groups(group_no);

-- Commit an all-Makkah single-BRN-per-night plan over a window (extensions)
create or replace function commit_window(p_group uuid, p_start date, p_end date)
returns boolean language plpgsql security definer set search_path = public as $$
declare grp umrah_groups%rowtype; res record; rec record; run record; v_cons uuid;
begin
  if p_start >= p_end then return true; end if;
  select * into grp from umrah_groups where id = p_group;
  select * into res from sim_plan(p_group, null, p_start, p_end);
  if not res.feasible then return false; end if;
  for rec in select distinct brn_id from unnest(res.plan) loop
    for run in
      select min(night) as s, max(night) as e, beds
      from (select night, beds, night - (dense_rank() over (partition by beds order by night))::int as island
            from unnest(res.plan) where brn_id = rec.brn_id) x
      group by beds, island order by 1
    loop
      v_cons := consume_brn(rec.brn_id, run.s, run.e + 1, run.beds, grp.group_no, 'Package-update');
      insert into group_brn_allocation(company_id, group_id, brn_id, consumption_id, beds)
      values (grp.company_id, p_group, rec.brn_id, v_cons, run.beds);
    end loop;
  end loop;
  return true;
end $$;
revoke all on function commit_window(uuid, date, date) from anon, public;

create or replace function update_package_brns(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
declare grp umrah_groups%rowtype; cf date; ct date; v_status text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into grp from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if grp.brn_status <> 'allocated' then raise exception 'Allocate BRNs first'; end if;
  if grp.visa_status = 'issued' then raise exception 'Visa already issued — reopen the group first'; end if;
  if grp.package_status is distinct from 'update_required' then raise exception 'This package does not require an update'; end if;
  if grp.covered_from is not null and grp.covered_from > grp.arrival_date then perform commit_window(p_group, grp.arrival_date, grp.covered_from); end if;
  if grp.covered_to is not null and grp.covered_to < grp.departure_date then perform commit_window(p_group, grp.covered_to, grp.departure_date); end if;
  select min(c.check_in), max(c.check_out) into cf, ct
  from group_brn_allocation ga join brn_consumption c on c.id = ga.consumption_id where ga.group_id = p_group;
  if cf <= grp.arrival_date and ct >= grp.departure_date then v_status := 'updated'; else v_status := 'update_required'; end if;
  update umrah_groups set covered_from = cf, covered_to = ct, package_status = v_status where id = p_group;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (grp.company_id, auth.uid(), 'package_update_allocated', 'umrah_group', p_group,
          jsonb_build_object('group_no', grp.group_no, 'covered_from', cf, 'covered_to', ct, 'status', v_status));
  if v_status = 'updated' then return 'updated'; else return 'partial'; end if;
end $$;
revoke all on function update_package_brns(uuid) from anon, public;
grant execute on function update_package_brns(uuid) to authenticated;

create or replace function release_consumption(p_consumption uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c brn_consumption%rowtype; v_group uuid; grp umrah_groups%rowtype; v_brn text; v_nights int; cf date; ct date;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'A reason is required to release a BRN'; end if;
  select * into c from brn_consumption where id = p_consumption;
  if not found then raise exception 'Consumption record not found'; end if;
  select group_id into v_group from group_brn_allocation where consumption_id = p_consumption limit 1;
  if v_group is not null then
    select * into grp from umrah_groups where id = v_group;
    if grp.visa_status = 'issued' then raise exception 'Cannot release: group % has an issued visa. Reopen the group first.', grp.group_no; end if;
  end if;
  select brn into v_brn from brn_inventory where id = c.brn_id;
  v_nights := (c.check_out - c.check_in);
  delete from group_brn_allocation where consumption_id = p_consumption;
  delete from brn_consumption where id = p_consumption;
  if v_group is not null then
    if not exists (select 1 from group_brn_allocation where group_id = v_group) then
      update umrah_groups set brn_status = 'pending', package_status = null, covered_from = null, covered_to = null where id = v_group;
    else
      select min(x.check_in), max(x.check_out) into cf, ct
      from group_brn_allocation ga join brn_consumption x on x.id = ga.consumption_id where ga.group_id = v_group;
      update umrah_groups set covered_from = cf, covered_to = ct,
        package_status = case when cf <= arrival_date and ct >= departure_date then 'complete' else 'update_required' end
        where id = v_group;
    end if;
  end if;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (auth_company_id(), auth.uid(), 'brn_released', 'brn_consumption', p_consumption,
          jsonb_build_object('brn', v_brn, 'group_no', coalesce(grp.group_no, c.reference),
                             'released_from', c.check_in, 'released_to', c.check_out,
                             'nights', v_nights, 'beds_restored', c.beds, 'reason', p_reason));
end $$;
revoke all on function release_consumption(uuid, text) from anon, public;
grant execute on function release_consumption(uuid, text) to authenticated;
