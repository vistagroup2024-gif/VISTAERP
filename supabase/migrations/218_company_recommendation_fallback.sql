-- 218_company_recommendation_fallback.sql
-- Visa Module — Company Inquiry policy change.
--
-- OLD policy: the recommendation simply surfaced the best-covered company; when
-- no company had inventory it still surfaced whichever ranked first (in practice
-- "Basma"). Agents were told to feed the booking into that top company even if it
-- barely covered the stay.
--
-- NEW policy (requested):
--   * A REAL company is recommended ("feed into that company") ONLY when it can
--     complete the allocation OR covers at least a minimum % of the required stay
--     (default 70%).
--   * Otherwise — the best company covers < 70%, or there is no company available
--     at all — recommend the designated FALLBACK company (default "Wadiyar"), and
--     the agent feeds the booking into it manually.
--
-- Both thresholds are configurable via erp_settings so the fallback company /
-- percentage can be changed later without a code deploy. The decision is made in
-- the shared recommend_companies() core so the Admin Portal and the B2B Agent
-- Portal behave identically.

-- Configurable knobs (safe defaults; Wadiyar is the fallback company).
insert into erp_settings (key, value) values
  ('recommendation_min_coverage_pct', '70'),
  ('recommendation_fallback_company', 'f0ca6b63-cae8-49c6-97b0-a71e5cd10f29')
on conflict (key) do nothing;

create or replace function recommend_companies(p_arrival date, p_departure date, p_pax int)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
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
end $$;

grant execute on function recommend_companies(date, date, int) to anon, authenticated;
