-- 043_brn_availability_status.sql (applied via MCP)
-- BRN readiness for groups in 'process': dry-run of the allocation window search
-- (no inventory consumed). Drives the admin statuses Ready to Allocate /
-- Ready to Allocate (partial) / Waiting BRN. Long Stay returns 'na'.
create or replace function brn_availability(p_group uuid)
 returns text language plpgsql stable security definer set search_path to 'public'
as $function$
declare grp umrah_groups%rowtype; res record; arr date; dep date; full_nights int; len int; s date;
begin
  select * into grp from umrah_groups where id = p_group;
  if not found then return 'none'; end if;
  if coalesce(grp.visa_type,'normal') = 'long_stay' then return 'na'; end if;
  if grp.group_company_id is null then return 'none'; end if;
  arr := grp.arrival_date; dep := grp.departure_date; full_nights := dep - arr;
  if full_nights >= 3 then
    select * into res from plan_window(p_group, arr, dep); if res.feasible then return 'complete'; end if;
  end if;
  if (dep - (arr + 1)) >= 3 then
    select * into res from plan_window(p_group, arr + 1, dep); if res.feasible then return 'complete'; end if;
  end if;
  if ((dep - 1) - arr) >= 3 then
    select * into res from plan_window(p_group, arr, dep - 1); if res.feasible then return 'complete'; end if;
  end if;
  for len in reverse full_nights .. 3 loop
    s := arr;
    while s + len <= dep loop
      select * into res from plan_window(p_group, s, s + len);
      if res.feasible then return 'partial'; end if;
      s := s + 1;
    end loop;
  end loop;
  return 'none';
end $function$;

create or replace function brn_availability_map()
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(id::text, brn_availability(id)), '{}'::jsonb)
  from umrah_groups
  where coalesce(workflow_status,'pending') = 'process' and coalesce(visa_type,'normal') <> 'long_stay';
$$;

grant execute on function brn_availability(uuid) to authenticated;
grant execute on function brn_availability_map() to authenticated;
