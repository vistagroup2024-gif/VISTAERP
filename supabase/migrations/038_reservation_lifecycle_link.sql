-- 038_reservation_lifecycle_link.sql
-- Reservation lifecycle refinement:
--   * A reservation is LINKED to a Visa Group at creation but stays ACTIVE
--     (still influences Company Inquiry) until the Admin allocates BRNs.
--   * At BRN allocation the reservation is CONSUMED (removed from the active
--     pool); the allocation itself then represents real inventory consumption.
--   * "Active" now means: not consumed AND (linked to a group OR not expired).
--   * Normal-visa groups require a reservation; Masar groups do not.

-- Link column
alter table company_reservations add column if not exists group_id uuid references umrah_groups(id);
create index if not exists idx_company_reservations_group on company_reservations (group_id) where not consumed;

-- Drop the old "consume on group insert" behaviour — creation now only LINKS.
drop trigger if exists trg_consume_reservations on umrah_groups;
drop function if exists consume_company_reservations();

-- Recommendation engine: a linked-but-unallocated reservation keeps holding
-- capacity regardless of the time-based expiry.
create or replace function recommend_companies(p_arrival date, p_departure date, p_pax int)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if p_arrival is null or p_departure is null or p_departure <= p_arrival or coalesce(p_pax, 0) <= 0 then
    raise exception 'Provide an arrival date, a later departure date, and pax greater than zero.';
  end if;

  with nights as (
    select d::date as night,
           (d::date = p_arrival) as is_first,
           (d::date = p_departure - 1) as is_last
    from generate_series(p_arrival, p_departure - 1, interval '1 day') d
  ),
  comp as (select id, name from group_companies where is_active = true),
  avail as (
    select c.id as company_id, n.night, n.is_first, n.is_last,
      greatest(0,
        coalesce((select sum(b.beds) from brn_inventory b
                  where b.group_company_id = c.id and b.check_in <= n.night and b.check_out > n.night), 0)
        - coalesce((select sum(cs.beds) from brn_consumption cs
                    join brn_inventory b2 on b2.id = cs.brn_id
                    where b2.group_company_id = c.id and cs.check_in <= n.night and cs.check_out > n.night), 0)
        - coalesce((select sum(r.pax) from company_reservations r
                    where r.group_company_id = c.id and not r.consumed
                      and (r.group_id is not null or r.expires_at > now())
                      and r.arrival_date <= n.night and r.departure_date > n.night), 0)
      ) as beds
    from comp c cross join nights n
  ),
  scored as (
    select a.company_id,
      count(*) as total_nights,
      count(*) filter (where a.beds >= p_pax) as covered_nights,
      count(*) filter (where not a.is_first and not a.is_last) as main_nights,
      count(*) filter (where not a.is_first and not a.is_last and a.beds >= p_pax) as main_covered,
      sum(a.beds) as bed_nights_avail,
      min(a.beds) as min_beds
    from avail a group by a.company_id
  ),
  ranked as (
    select s.*, c.name,
      case when s.main_nights = 0 then (s.covered_nights = s.total_nights)
           else (s.main_covered = s.main_nights) end as complete,
      coalesce((select sum(r.pax) from company_reservations r
                where r.group_company_id = s.company_id and not r.consumed
                  and (r.group_id is not null or r.expires_at > now())
                  and r.arrival_date < p_departure and r.departure_date > p_arrival), 0) as reserved_beds
    from scored s join comp c on c.id = s.company_id
  )
  select jsonb_agg(jsonb_build_object(
    'id', company_id, 'name', name, 'complete', complete,
    'covered_nights', covered_nights, 'total_nights', total_nights,
    'pct', case when total_nights > 0 then round(100.0 * covered_nights / total_nights) else 0 end,
    'available_bed_nights', bed_nights_avail, 'min_beds', min_beds, 'reserved_beds', reserved_beds
  ) order by complete desc, covered_nights desc, bed_nights_avail desc)
  into v from ranked;

  return coalesce(v, '[]'::jsonb);
end $$;

-- Active reservations list (for the Company Inquiry panel). Includes linked ones.
create or replace function active_reservations()
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'company', gc.name, 'group_company_id', r.group_company_id,
    'arrival_date', r.arrival_date, 'departure_date', r.departure_date, 'pax', r.pax,
    'source', r.source, 'created_by', r.created_by, 'expires_at', r.expires_at,
    'group_id', r.group_id, 'group_no', g.group_no
  ) order by r.expires_at), '[]'::jsonb)
  from company_reservations r
  join group_companies gc on gc.id = r.group_company_id
  left join umrah_groups g on g.id = r.group_id
  where not r.consumed and (r.group_id is not null or r.expires_at > now());
$$;

create or replace function b2b_active_reservations(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'company', gc.name, 'group_company_id', r.group_company_id,
      'arrival_date', r.arrival_date, 'departure_date', r.departure_date, 'pax', r.pax,
      'source', r.source, 'created_by', r.created_by, 'expires_at', r.expires_at,
      'group_id', r.group_id, 'group_no', g.group_no
    ) order by r.expires_at), '[]'::jsonb)
    from company_reservations r
    join group_companies gc on gc.id = r.group_company_id
    left join umrah_groups g on g.id = r.group_id
    where r.agent_id = a.id and not r.consumed and (r.group_id is not null or r.expires_at > now())
  );
end $$;

-- Form-eligible reservations: active, UNLINKED (group_id is null), for a company.
create or replace function form_reservations(p_company uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'arrival_date', r.arrival_date, 'departure_date', r.departure_date,
    'pax', r.pax, 'created_by', r.created_by, 'expires_at', r.expires_at
  ) order by r.created_at desc), '[]'::jsonb)
  from company_reservations r
  where r.group_company_id = p_company and not r.consumed and r.group_id is null and r.expires_at > now();
$$;

create or replace function b2b_form_reservations(p_token text, p_company uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'arrival_date', r.arrival_date, 'departure_date', r.departure_date,
      'pax', r.pax, 'created_by', r.created_by, 'expires_at', r.expires_at
    ) order by r.created_at desc), '[]'::jsonb)
    from company_reservations r
    where r.agent_id = a.id and r.group_company_id = p_company
      and not r.consumed and r.group_id is null and r.expires_at > now()
  );
end $$;

-- Link a reservation to a group (staff/admin path; agent path is inside b2b_create_group).
create or replace function link_reservation_to_group(p_reservation uuid, p_group uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $$ begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update company_reservations set group_id = p_group
  where id = p_reservation and not consumed and group_id is null;
end $$;

-- Consume the linked reservation when BRNs are allocated (finalize point).
create or replace function allocate_group_brns(p_group uuid)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  grp umrah_groups%rowtype; res record; chosen_plan brn_plan_row[]; chosen boolean := false;
  arr date; dep date; full_nights int; len int; s date; rec record; run record; v_cons uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform set_config('vista.bypass_guard', '1', true);
  select * into grp from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if grp.group_company_id is null then raise exception 'This group has no Company assigned. Set the group''s company before allocating.'; end if;
  if grp.brn_status = 'allocated' then raise exception 'Group % already has BRNs allocated', grp.group_no; end if;

  arr := grp.arrival_date; dep := grp.departure_date; full_nights := dep - arr;
  if full_nights >= 3 then
    select * into res from plan_window(p_group, arr, dep);
    if res.feasible then chosen_plan := res.plan; chosen := true; end if;
  end if;
  if not chosen and (dep - (arr + 1)) >= 3 then
    select * into res from plan_window(p_group, arr + 1, dep);
    if res.feasible then chosen_plan := res.plan; chosen := true; end if;
  end if;
  if not chosen and ((dep - 1) - arr) >= 3 then
    select * into res from plan_window(p_group, arr, dep - 1);
    if res.feasible then chosen_plan := res.plan; chosen := true; end if;
  end if;
  if not chosen then
    for len in reverse full_nights .. 3 loop
      s := arr;
      while s + len <= dep loop
        select * into res from plan_window(p_group, s, s + len);
        if res.feasible then chosen_plan := res.plan; chosen := true; exit; end if;
        s := s + 1;
      end loop;
      exit when chosen;
    end loop;
  end if;
  if not chosen then
    raise exception 'Cannot allocate: no single-BRN coverage of at least 3 nights is available for this group''s company (Nusuk requires a minimum of 3 hotel nights). Purchase additional BRN inventory.';
  end if;

  for rec in select distinct brn_id from unnest(chosen_plan) loop
    for run in
      select min(night) as s, max(night) as e, beds
      from (select night, beds, night - (dense_rank() over (partition by beds order by night))::int as island
            from unnest(chosen_plan) where brn_id = rec.brn_id) x
      group by beds, island order by 1
    loop
      v_cons := consume_brn(rec.brn_id, run.s, run.e + 1, run.beds, grp.group_no, 'Auto-allocated');
      insert into group_brn_allocation(company_id, group_id, brn_id, consumption_id, beds)
      values (grp.company_id, p_group, rec.brn_id, v_cons, run.beds);
    end loop;
  end loop;

  perform recompute_group_coverage(p_group, 'fresh');
  update umrah_groups set workflow_status = 'brn_allocated'
   where id = p_group and coalesce(workflow_status, 'pending') = 'pending';
  -- Finalize the reservation: BRN allocation is now the real inventory consumption.
  update company_reservations set consumed = true where group_id = p_group and not consumed;
  select * into grp from umrah_groups where id = p_group;
  if grp.package_status = 'update_required' then
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (grp.company_id, auth.uid(), 'package_update_required', 'umrah_group', p_group,
            jsonb_build_object('group_no', grp.group_no, 'covered_from', grp.covered_from, 'covered_to', grp.covered_to));
  end if;
  return grp.pax;
end $function$;

-- Group creation now accepts + validates + links a reservation (Normal only).
create or replace function b2b_create_group(p_token text, p jsonb)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare a b2b_agents%rowtype; v_id uuid; v_visa text; v_res uuid; r_row company_reservations%rowtype;
begin
  a := b2b_agent_of(p_token);
  if not (a.permissions ? 'visa.create' and (a.permissions->>'visa.create')::boolean) then raise exception 'No permission to create visa groups'; end if;
  if coalesce(trim(p->>'group_no'),'') = '' then raise exception 'Group number is required'; end if;
  v_visa := coalesce(nullif(p->>'visa_type',''), 'normal');
  v_res := nullif(p->>'reservation_id','')::uuid;

  if v_visa = 'normal' then
    if v_res is null then raise exception 'Please select a reservation for this Normal Visa group. Create one using Company Inquiry.'; end if;
    select * into r_row from company_reservations where id = v_res;
    if not found then raise exception 'Reservation not found.'; end if;
    if r_row.consumed or r_row.group_id is not null then raise exception 'That reservation is no longer available.'; end if;
    if r_row.agent_id is distinct from a.id then raise exception 'That reservation does not belong to you.'; end if;
    if r_row.group_company_id is distinct from nullif(p->>'group_company_id','')::uuid then raise exception 'The reservation is for a different company than the one selected.'; end if;
  end if;

  perform set_config('vista.bypass_guard','1',true);
  insert into umrah_groups(company_id, group_no, group_date, agent_id, group_company_id, group_name, pax,
    arrival_date, departure_date, arrival_flight, arrival_from, arrival_airport,
    departure_flight, departure_to, departure_airport, remarks, hotel_details,
    visa_type, workflow_status, brn_status, visa_status)
  values (a.company_id, trim(p->>'group_no'), current_date, a.agent_party_id, nullif(p->>'group_company_id','')::uuid,
    nullif(p->>'group_name',''), coalesce((p->>'pax')::int,0),
    (p->>'arrival_date')::date, (p->>'departure_date')::date, nullif(p->>'arrival_flight',''),
    nullif(p->>'arrival_from',''), nullif(p->>'arrival_airport',''), nullif(p->>'departure_flight',''),
    nullif(p->>'departure_to',''), nullif(p->>'departure_airport',''), nullif(p->>'remarks',''),
    coalesce(p->'hotel_details','[]'::jsonb), v_visa, 'pending', 'pending', 'pending')
  returning id into v_id;

  if v_res is not null then
    update company_reservations set group_id = v_id
    where id = v_res and not consumed and group_id is null and agent_id = a.id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'This Group Number already exists. Please use a unique Group Number.';
end $function$;

grant execute on function form_reservations(uuid) to anon, authenticated;
grant execute on function b2b_form_reservations(text, uuid) to anon, authenticated;
grant execute on function link_reservation_to_group(uuid, uuid) to authenticated;
