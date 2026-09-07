-- 295 The fare chart, by rate period.
--
-- Selling rates are effective-dated rows, so the chart is only ever true "as on"
-- a date — and the office thinks in periods, not dates: rates were set for
-- 7 Sep - 1 Nov, then a bulk update for 1 Nov - 1 Jan, then another from 1 Jan.
-- This turns the rows back into those periods.
--
-- A period is a stretch over which the RESOLVED chart does not change. That is
-- not the same as "one bulk update": a bulk update that only touches routes this
-- agent is already priced differently for changes nothing they see, and a
-- boundary nobody notices is noise on the screen. So the boundaries are computed
-- from the dates a rate could change (every effective_from, and every
-- effective_to + 1) and then CONSECUTIVE BOUNDARIES WITH AN IDENTICAL CHART ARE
-- MERGED. What comes back is the list of genuinely different fare charts and the
-- span each one is in force for.
--
-- Every price is resolved by transport_agent_rate() — the same function the
-- chart and the agent's own portal go through — so a period boundary always
-- lines up with a real change in what the agent is quoted.
--
-- Package prices (transport_package_prices) carry no dates, so they are the same
-- in every period; the periods here are the route rates.
create or replace function public.transport_rate_periods(p_party uuid default null)
returns jsonb language sql stable security invoker set search_path to 'public' as $$
  with co as (select auth_company_id() as id),
  -- Every date on which a rate that applies to this party could start or stop.
  bounds as (
    select distinct d from (
      select effective_from as d from transport_agent_rates
       where company_id = (select id from co) and status = 'active'
         and (agent_id is not distinct from p_party or agent_id is null)
      union
      select effective_to + 1 from transport_agent_rates
       where company_id = (select id from co) and status = 'active'
         and (agent_id is not distinct from p_party or agent_id is null)
         and effective_to is not null
    ) x where d is not null
  ),
  -- The whole chart at each boundary, as one signature.
  sig as (
    select b.d,
           count(x.rate) as cells,
           md5(coalesce(string_agg(r.id::text || ve.id::text || x.rate::text, ',' order by r.id, ve.id)
                        filter (where x.rate is not null), '')) as s
    from bounds b
    cross join transport_routes r
    cross join transport_vehicles ve
    cross join lateral (select transport_agent_rate((select id from co), p_party, r.id, ve.id, b.d) as rate) x
    where r.company_id = (select id from co) and r.is_active
      and ve.company_id = (select id from co) and ve.is_active
    group by b.d
  ),
  -- Consecutive boundaries that resolve to the same chart are one period.
  -- Two steps, because a window function may not be nested inside another.
  marked as (
    select d, cells, s, lag(s) over (order by d) as prev_s from sig
  ),
  runs as (
    select d, cells, s,
           sum(case when s is distinct from prev_s then 1 else 0 end) over (order by d) as grp
    from marked
  ),
  periods as (
    select grp, min(d) as from_date, max(cells) as cells from runs group by grp
  ),
  windowed as (
    -- A period runs until the next one starts; the last is open-ended.
    select from_date, cells, lead(from_date) over (order by from_date) as to_date
    from periods
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'from',    from_date,
           'to',      to_date,
           'cells',   cells,
           -- Past periods are the "old rates history": over, kept, out of the way.
           'past',    to_date is not null and to_date <= current_date,
           'current', from_date <= current_date and (to_date is null or to_date > current_date),
           'future',  from_date > current_date) order by from_date), '[]'::jsonb)
  from windowed
  where cells > 0;
$$;

revoke all on function public.transport_rate_periods(uuid) from public, anon;
grant execute on function public.transport_rate_periods(uuid) to authenticated;
