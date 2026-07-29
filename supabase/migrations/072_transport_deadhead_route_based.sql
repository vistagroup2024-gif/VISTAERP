-- 072_transport_deadhead_route_based
-- Deadhead (empty repositioning) must be derived from the Route Master, not from
-- the free-text pickup/drop addresses on a trip. Between two consecutive trips
-- the driver sits at the PREVIOUS trip route's to_location and must reach the
-- NEXT trip route's from_location. We look up the travel time of the route that
-- connects those two endpoints (either direction) and require the gap to cover it.
--
-- Example: Trip 1 route Makkah -> Jeddah Airport, Trip 2 route Makkah -> Madinah.
-- Driver ends at Jeddah Airport, next trip departs Makkah. The engine looks up
-- the Jeddah Airport <-> Makkah route's driving_minutes and only allows the
-- assignment if the driver can reposition in time.

create or replace function public.transport_driver_reason(p_trip uuid, p_driver uuid)
returns text
language plpgsql
stable
set search_path to 'public'
as $$
declare
  cand record;
  r record;
  has_prev boolean := false;
  prev_e timestamp;
  prev_to text;
  seg_start timestamp;
  gap_min numeric;
  need_min int;
begin
  select ts.company_id, ts.sched_s, ts.sched_e, rt.from_location as r_from, rt.to_location as r_to
    into cand
  from transport_trip_sched ts
  left join transport_routes rt on rt.id = ts.route_id
  where ts.id = p_trip;
  if not found then return 'Trip not found.'; end if;
  if cand.sched_s is null then return 'Set the trip date and time first.'; end if;

  for r in
    select s, e, r_from, r_to from (
      -- the driver's other trips (window around the candidate day covers rest
      -- periods that straddle midnight). Route endpoints drive the deadhead calc.
      select ts.sched_s as s, ts.sched_e as e, rt.from_location as r_from, rt.to_location as r_to
      from transport_trip_sched ts
      left join transport_routes rt on rt.id = ts.route_id
      where ts.driver_id = p_driver and ts.id <> p_trip and ts.status <> 'cancelled'
        and ts.sched_s is not null
        and ts.trip_date between cand.sched_s::date - 1 and cand.sched_s::date + 1
      union all
      select cand.sched_s, cand.sched_e, cand.r_from, cand.r_to
    ) q
    order by s, e
  loop
    if not has_prev then
      seg_start := r.s;
    else
      if r.s < prev_e then
        return 'Driver already has an overlapping trip at this time.';
      end if;
      gap_min := extract(epoch from (r.s - prev_e)) / 60;
      if gap_min >= 600 then
        -- >=10h idle -> mandatory rest satisfied, a new duty period begins
        seg_start := r.s;
      else
        -- reposition from the previous route's destination to the next route's origin
        need_min := transport_deadhead_min(cand.company_id, prev_to, r.r_from);
        if gap_min < need_min then
          return 'Not enough repositioning (deadhead) travel time between consecutive trips.';
        end if;
        if extract(epoch from (r.e - seg_start)) / 3600 > 12 then
          return 'Exceeds the 12-hour maximum working period (a 10-hour continuous rest is required).';
        end if;
      end if;
    end if;
    has_prev := true;
    prev_e := r.e;
    prev_to := r.r_to;
  end loop;

  return null;
end $$;
