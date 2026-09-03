-- 286 Say WHY a group is waiting for BRN, instead of just that it is.
--
-- "Waiting BRN" is computed correctly but explains nothing, so the natural way
-- to check it is to open BRN Inventory and look for free beds — where the
-- Available column showed the best single night, and beds belonging to another
-- group company look just like your own. A group needing 12 beds can then sit
-- on "Waiting BRN" next to a screen that appears to offer 12.
--
-- This returns the arithmetic behind the badge for one group: how many beds it
-- needs, the biggest block its OWN group company has free across its stay, and
-- which nights that block covers.
create or replace function public.brn_shortfall(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare grp umrah_groups%rowtype; v_gc text; r record;
begin
  select * into grp from umrah_groups where id = p_group;
  if not found then return null; end if;
  select name into v_gc from group_companies where id = grp.group_company_id;

  -- Free beds per night of the stay, counting only this group company's BRNs.
  with nights as (
    select d::date as night from generate_series(grp.arrival_date, grp.departure_date - interval '1 day', interval '1 day') d
  ),
  per_night as (
    select n.night,
           coalesce(sum(inv.beds - coalesce((select sum(cc.beds) from brn_consumption cc
                     where cc.brn_id = inv.id and cc.check_in <= n.night and cc.check_out > n.night), 0)), 0) as free
    from nights n
    left join brn_inventory inv
           on inv.company_id = grp.company_id
          and inv.group_company_id is not distinct from grp.group_company_id
          and inv.check_in <= n.night and inv.check_out > n.night
    group by n.night
  ),
  -- The longest run of consecutive nights that can seat the whole group.
  ok as (select night, (free >= grp.pax) as fits from per_night),
  runs as (
    select night, fits, night - (row_number() over (partition by fits order by night))::int as grp_key
    from ok
  ),
  best as (
    select count(*) as nights, min(night) as from_night, max(night) + 1 as to_night
    from runs where fits group by grp_key order by count(*) desc limit 1
  )
  select (select max(free) from per_night) as best_night_free,
         (select min(free) from per_night) as worst_night_free,
         b.nights, b.from_night, b.to_night
    into r
  from (select 1) x left join best b on true;

  return jsonb_build_object(
    'pax', grp.pax,
    'nights_needed', grp.departure_date - grp.arrival_date,
    'group_company', v_gc,
    'best_night_free', coalesce(r.best_night_free, 0),
    'worst_night_free', coalesce(r.worst_night_free, 0),
    'covered_nights', coalesce(r.nights, 0),
    'covered_from', r.from_night,
    'covered_to', r.to_night
  );
end $$;
revoke all on function public.brn_shortfall(uuid) from anon;
