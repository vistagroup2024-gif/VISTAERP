-- Migration 429 added `if not is_staff() then raise exception 'Not
-- authorized'` to recommend_companies() and create_company_reservation()
-- (both overloads) -- correct for the direct staff-facing path, but
-- b2b_recommend_companies() and b2b_create_company_reservation() are
-- SECURITY DEFINER wrappers that called those same functions internally as
-- their engine, authenticating the caller through b2b_agent_of(p_token)
-- instead of a Supabase session. is_staff() is false for a B2B agent's
-- token-only call, so 429 silently broke Check Company Availability (and
-- Reserve) for every agent -- "Not authorized" on a valid, active agent
-- (verified: Alpha Travels, party_type b2b_agent, is_active) is that gate,
-- not a real permission problem.
--
-- Same "engine is never gated, a door carries the right" split this project
-- already uses elsewhere (invoice_bill_save -> party_invoice): the actual
-- logic moves into *_internal, ungranted to anyone; recommend_companies()
-- and create_company_reservation() become thin is_staff() doors over it;
-- the b2b_* wrappers call the internal engine directly, since their own
-- token check already is the authorization.

create or replace function public.recommend_companies_internal(p_arrival date, p_departure date, p_pax integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
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

revoke all on function public.recommend_companies_internal(date,date,integer) from public, anon, authenticated;

create or replace function public.recommend_companies(p_arrival date, p_departure date, p_pax integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  return recommend_companies_internal(p_arrival, p_departure, p_pax);
end $function$;

revoke all on function public.recommend_companies(date,date,integer) from public, anon;
grant execute on function public.recommend_companies(date,date,integer) to authenticated;

create or replace function public.b2b_recommend_companies(p_token text, p_arrival date, p_departure date, p_pax integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin
  perform b2b_agent_of(p_token);
  return recommend_companies_internal(p_arrival, p_departure, p_pax);
end $function$;

create or replace function public.create_company_reservation_internal(
  p_company uuid, p_arrival date, p_departure date, p_pax integer,
  p_source text DEFAULT 'admin', p_created_by text DEFAULT NULL, p_agent_id uuid DEFAULT NULL, p_hours integer DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_min int;
begin
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

revoke all on function public.create_company_reservation_internal(uuid,date,date,integer,text,text,uuid,integer) from public, anon, authenticated;

create or replace function public.create_company_reservation(p_company uuid, p_arrival date, p_departure date, p_pax integer, p_source text DEFAULT 'admin'::text, p_created_by text DEFAULT NULL::text, p_agent_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  return create_company_reservation_internal(p_company, p_arrival, p_departure, p_pax, p_source, p_created_by, p_agent_id, null);
end $function$;

create or replace function public.create_company_reservation(p_company uuid, p_arrival date, p_departure date, p_pax integer, p_source text DEFAULT 'admin'::text, p_created_by text DEFAULT NULL::text, p_agent_id uuid DEFAULT NULL::uuid, p_hours integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  return create_company_reservation_internal(p_company, p_arrival, p_departure, p_pax, p_source, p_created_by, p_agent_id, p_hours);
end $function$;

revoke all on function public.create_company_reservation(uuid,date,date,integer,text,text,uuid) from public, anon;
grant execute on function public.create_company_reservation(uuid,date,date,integer,text,text,uuid) to authenticated;
revoke all on function public.create_company_reservation(uuid,date,date,integer,text,text,uuid,integer) from public, anon;
grant execute on function public.create_company_reservation(uuid,date,date,integer,text,text,uuid,integer) to authenticated;

create or replace function public.b2b_create_company_reservation(p_token text, p_company uuid, p_arrival date, p_departure date, p_pax integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return create_company_reservation_internal(p_company, p_arrival, p_departure, p_pax, 'agent', a.agency_name, a.id, null);
end $function$;

create or replace function public.b2b_create_company_reservation(p_token text, p_company uuid, p_arrival date, p_departure date, p_pax integer, p_hours integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return create_company_reservation_internal(p_company, p_arrival, p_departure, p_pax, 'agent', a.agency_name, a.id, p_hours);
end $function$;
