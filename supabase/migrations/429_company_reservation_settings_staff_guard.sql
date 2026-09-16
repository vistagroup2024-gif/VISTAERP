-- Security audit finding: create_company_reservation (both overloads),
-- release_company_reservation, set_setting, recommend_companies,
-- form_reservations and active_reservations are all SECURITY DEFINER —
-- they run as their owner, so RLS never reaches them — and had NO internal
-- check at all, while their own sibling in the same feature,
-- link_reservation_to_group, already does `if not is_staff() then raise
-- exception 'Not authorized'; end if;`. Anything with a valid Supabase
-- session could call them directly via /rest/v1/rpc/..., including a staff
-- account outside its login window or switched inactive — is_staff() is
-- what carries that check everywhere else in this project (CLAUDE.md: "It
-- is not a 'does a profile exist' check any more... every RLS policy in the
-- database closes with it"), and these were the one path around it.
--
-- set_setting is the sharper one: a generic, unscoped key/value writer over
-- erp_settings with no key allowlist, reachable by anyone with a session.
-- Brought every one of these in line with link_reservation_to_group's own
-- existing pattern — no other change to any of their logic.
create or replace function public.set_setting(p_key text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  insert into erp_settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $function$;

create or replace function public.release_company_reservation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update company_reservations set consumed = true where id = p_id;
end $function$;

create or replace function public.create_company_reservation(p_company uuid, p_arrival date, p_departure date, p_pax integer, p_source text DEFAULT 'admin'::text, p_created_by text DEFAULT NULL::text, p_agent_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_min int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_company is null or p_arrival is null or p_departure is null or p_departure <= p_arrival or coalesce(p_pax,0) <= 0 then
    raise exception 'Invalid reservation.';
  end if;
  v_min := coalesce(nullif(get_setting('company_reservation_minutes', '20'), '')::int, 20);
  insert into company_reservations (group_company_id, arrival_date, departure_date, pax, source, created_by, agent_id, expires_at)
  values (p_company, p_arrival, p_departure, p_pax, coalesce(p_source,'admin'), p_created_by, p_agent_id, now() + make_interval(mins => v_min))
  returning id into v_id;
  return v_id;
end $function$;

create or replace function public.create_company_reservation(p_company uuid, p_arrival date, p_departure date, p_pax integer, p_source text DEFAULT 'admin'::text, p_created_by text DEFAULT NULL::text, p_agent_id uuid DEFAULT NULL::uuid, p_hours integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_min int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_company is null or p_arrival is null or p_departure is null or p_departure <= p_arrival or coalesce(p_pax,0) <= 0 then
    raise exception 'Invalid reservation.';
  end if;
  if p_hours is not null then v_min := least(greatest(p_hours, 1), 6) * 60;
  else v_min := coalesce(nullif(get_setting('company_reservation_minutes', '20'), '')::int, 20); end if;
  insert into company_reservations (group_company_id, arrival_date, departure_date, pax, source, created_by, agent_id, expires_at)
  values (p_company, p_arrival, p_departure, p_pax, coalesce(p_source,'admin'), p_created_by, p_agent_id, now() + make_interval(mins => v_min))
  returning id into v_id;
  return v_id;
end $function$;

create or replace function public.recommend_companies(p_arrival date, p_departure date, p_pax integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_arrival is null or p_departure is null or p_departure <= p_arrival or coalesce(p_pax, 0) <= 0 then
    raise exception 'Provide an arrival date, a later departure date, and pax greater than zero.';
  end if;

  with params as (
    select coalesce(nullif(get_setting('recommendation_min_coverage_pct', '70'), '')::int, 70) as thresh,
           nullif(get_setting('recommendation_fallback_company', 'f0ca6b63-cae8-49c6-97b0-a71e5cd10f29'), '')::uuid as fallback
  ),
  nights as (
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
                    where r.group_company_id = c.id and not r.consumed and r.expires_at > now()
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
      case when s.total_nights > 0 then round(100.0 * s.covered_nights / s.total_nights)::int else 0 end as pct,
      coalesce((select sum(r.pax) from company_reservations r
                where r.group_company_id = s.company_id and not r.consumed and r.expires_at > now()
                  and r.arrival_date < p_departure and r.departure_date > p_arrival), 0) as reserved_beds
    from scored s join comp c on c.id = s.company_id
  ),
  ord as (
    select r.*, row_number() over (order by r.complete desc, r.covered_nights desc, r.bed_nights_avail desc) as rn
    from ranked r
  ),
  best as (select company_id, pct, complete from ord where rn = 1),
  decision as (
    select
      case
        when (select company_id from best) is null then (select fallback from params)
        when (select complete from best) or (select pct from best) >= (select thresh from params)
          then (select company_id from best)
        when (select fallback from params) is not null
             and exists (select 1 from ord where company_id = (select fallback from params))
          then (select fallback from params)
        else (select company_id from best)
      end as reco_id,
      case
        when (select company_id from best) is null then true
        when (select complete from best) or (select pct from best) >= (select thresh from params)
          then false
        when (select fallback from params) is not null
             and exists (select 1 from ord where company_id = (select fallback from params))
          then true
        else false
      end as is_fallback
  )
  select jsonb_agg(jsonb_build_object(
    'id', o.company_id, 'name', o.name, 'complete', o.complete,
    'covered_nights', o.covered_nights, 'total_nights', o.total_nights,
    'pct', o.pct,
    'available_bed_nights', o.bed_nights_avail, 'min_beds', o.min_beds, 'reserved_beds', o.reserved_beds,
    'recommended', (o.company_id = d.reco_id),
    'is_fallback', (o.company_id = d.reco_id and d.is_fallback)
  ) order by (o.company_id = d.reco_id) desc, o.complete desc, o.covered_nights desc, o.bed_nights_avail desc)
  into v
  from ord o cross join decision d;

  return coalesce(v, '[]'::jsonb);
end $function$;

create or replace function public.form_reservations(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not is_staff() then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'arrival_date', r.arrival_date, 'departure_date', r.departure_date,
    'pax', r.pax, 'created_by', r.created_by, 'expires_at', r.expires_at
  ) order by r.created_at desc), '[]'::jsonb) end
  from company_reservations r
  where is_staff() and r.group_company_id = p_company and not r.consumed and r.group_id is null and r.expires_at > now();
$function$;

create or replace function public.active_reservations()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not is_staff() then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'company', gc.name, 'group_company_id', r.group_company_id,
    'arrival_date', r.arrival_date, 'departure_date', r.departure_date, 'pax', r.pax,
    'source', r.source, 'created_by', r.created_by, 'expires_at', r.expires_at,
    'group_id', r.group_id, 'group_no', g.group_no
  ) order by r.expires_at), '[]'::jsonb) end
  from company_reservations r join group_companies gc on gc.id = r.group_company_id
  left join umrah_groups g on g.id = r.group_id
  where is_staff() and not r.consumed and (r.group_id is not null or r.expires_at > now());
$function$;
