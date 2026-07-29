-- 073_transport_deadhead_strict
-- Deadhead repositioning must ALWAYS come from the Route Master — never an
-- estimate. If the repositioning route (previous route's destination -> next
-- route's origin) is not defined, the time is UNKNOWN and the driver is
-- excluded, with a warning naming the missing route.

-- Return the Route Master travel time (minutes) between two locations.
-- 0 when identical/absent endpoints; NULL when the two differ but no route
-- connects them (i.e. repositioning time is unknown).
create or replace function public.transport_deadhead_min(p_company uuid, p_from text, p_to text)
returns int
language sql
stable
set search_path to 'public'
as $$
  select case
    when p_from is null or p_to is null then 0
    when lower(btrim(p_from)) = lower(btrim(p_to)) then 0
    else (
      select min(driving_minutes) from transport_routes
      where company_id = p_company and coalesce(is_active, true)
        and driving_minutes is not null
        and (
          (lower(btrim(from_location)) = lower(btrim(p_from)) and lower(btrim(to_location)) = lower(btrim(p_to)))
          or (lower(btrim(from_location)) = lower(btrim(p_to)) and lower(btrim(to_location)) = lower(btrim(p_from)))
        )
    )
  end;
$$;

-- Feasibility of assigning a driver, using Route-Master deadhead strictly.
-- Sequence per consecutive pair: previous trip end -> reposition from previous
-- route destination to next route origin (Route Master) -> arrival time ->
-- must arrive on/before next pickup. Also enforces 10h rest / 12h duty window.
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
        -- reposition from the previous route destination to the next route origin
        if prev_to is not null and r.r_from is not null
           and lower(btrim(prev_to)) <> lower(btrim(r.r_from)) then
          need_min := transport_deadhead_min(cand.company_id, prev_to, r.r_from);
          if need_min is null then
            return format('Repositioning route missing from Route Master (%s → %s). Add this route to enable assignment.', prev_to, r.r_from);
          end if;
          if gap_min < need_min then
            return 'Not enough repositioning (deadhead) travel time between consecutive trips.';
          end if;
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
