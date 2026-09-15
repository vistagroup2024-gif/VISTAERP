-- ============================================================
-- 388 — A Jeddah Airport pickup has a 30-minute grace
--
-- A pickup at Jeddah Airport is not actually due the instant the trip's
-- scheduled time hits: the passenger is still clearing immigration and
-- collecting luggage, which the business allows 45 minutes to an hour for.
-- So a driver reaching the airport up to 30 minutes after the scheduled
-- pickup time is not late for it — and `transport_driver_reason`'s
-- repositioning check, which asks "does the driver have enough time between
-- the end of his last trip and the start of this one to get here", gets the
-- same 30 minutes of slack, capped at 30 and no more.
--
-- Found live: Muzammil already had two trips today — Madinah → Makkah ending
-- 16:30, then Jeddah Airport → Makkah Hotel starting 17:45 — 75 minutes
-- apart, while the Route Master says Makkah → Jeddah Airport needs 90. That
-- gap was never a problem on its own; it only surfaced when a third trip
-- (tomorrow 05:10, also from Jeddah Airport) chained onto the same duty
-- window with no 10-hour rest in between, and the checker walked every gap
-- in that window, including this one. The 30-minute grace is what the
-- business actually allows for an airport pickup, so this gap is not a real
-- conflict: 75 + 30 = 105 ≥ 90.
--
-- The reported "only % min available" in the error still shows the real
-- schedule gap (75), not the padded one — the grace changes what counts as
-- enough, not what the gap actually is.
--
-- This is `transport_driver_reason`, the one routine behind manual assign
-- (`transport_assign_check`, `transport_assign_trip`) and auto-assign, so the
-- grace applies everywhere a driver is checked against a trip, not just here.
-- It does NOT touch `transport_reposition_conflict` (the >100 km approval
-- rule) or the initial-reposition work-hours count — those ask different
-- questions: whether a long reposition needs sign-off, and whether the
-- driver's day fits in 12 hours. Only "is the driver late for the pickup" is
-- softened.
-- ============================================================
begin;

CREATE OR REPLACE FUNCTION public.transport_driver_reason(p_trip uuid, p_driver uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  cand record; drv record;
  v_pax int; need_min int; v_loc text;
  arr_s timestamptz[]; arr_e timestamptz[]; arr_from text[]; arr_to text[]; arr_cand boolean[];
  n int; i int; ci int; lo int; hi int;
  seg_start timestamptz; work_min numeric := 0; span_min numeric; gap_min numeric; avail_min numeric;
begin
  select ts.company_id, ts.booking_id, ts.sched_s, ts.sched_e, ts.passenger_visa_type as visa,
         transport_route_origin(rt.name, rt.from_location, rt.to_location) as r_from,
         transport_route_dest(rt.name, rt.from_location, rt.to_location)   as r_to
    into cand
  from transport_trip_sched ts
  left join transport_routes rt on rt.id = ts.route_id
  where ts.id = p_trip;
  if not found then return 'Trip not found.'; end if;
  if cand.sched_s is null then return 'Set the trip date and time first.'; end if;

  select d.nusuk_registered, d.vehicle_id, v.seating_capacity into drv
  from transport_drivers d left join transport_vehicles v on v.id = d.vehicle_id
  where d.id = p_driver;

  select pax into v_pax from transport_bookings where id = cand.booking_id;
  if drv.seating_capacity is not null and v_pax is not null and drv.seating_capacity < v_pax then
    return format('Vehicle capacity (%s) is less than the passenger count (%s).', drv.seating_capacity, v_pax);
  end if;

  if lower(coalesce(cand.visa,'')) = 'umrah'
     and coalesce(cand.r_from,'') ilike '%airport%' and coalesce(cand.r_from,'') ilike '%jeddah%'
     and not coalesce(drv.nusuk_registered, false) then
    return 'Driver is not Nusuk-registered (required for Umrah-visa Jeddah Airport arrivals).';
  end if;

  select array_agg(s order by rn), array_agg(e order by rn), array_agg(rf order by rn),
         array_agg(rd order by rn), array_agg(ic order by rn)
    into arr_s, arr_e, arr_from, arr_to, arr_cand
  from (
    select s, e, rf, rd, ic, row_number() over (order by s, e, ic) as rn
    from (
      select ts.sched_s as s, ts.sched_e as e,
             transport_route_origin(rt.name, rt.from_location, rt.to_location) as rf,
             transport_route_dest(rt.name, rt.from_location, rt.to_location)   as rd,
             false as ic
      from transport_trip_sched ts
      left join transport_routes rt on rt.id = ts.route_id
      where ts.driver_id = p_driver and ts.id <> p_trip and ts.status <> 'cancelled'
        and ts.sched_s is not null
        and ts.trip_date between cand.sched_s::date - 1 and cand.sched_s::date + 1
      union all
      select cand.sched_s, cand.sched_e, cand.r_from, cand.r_to, true
    ) u
  ) q;

  n := coalesce(array_length(arr_s, 1), 0);
  if n <= 1 then
    if arr_from is null then return null; end if;
  end if;

  ci := null;
  for i in 1..greatest(n,1) loop if arr_cand[i] then ci := i; exit; end if; end loop;
  lo := ci; hi := ci;
  while lo > 1 and extract(epoch from (arr_s[lo] - arr_e[lo-1])) / 60 < 600 loop
    lo := lo - 1;
  end loop;
  while hi < n and extract(epoch from (arr_s[hi+1] - arr_e[hi])) / 60 < 600 loop
    hi := hi + 1;
  end loop;

  seg_start := arr_s[lo];

  -- Initial reposition: driver must drive from where they are now to the first trip's
  -- origin. That drive is real work and counts toward the 12h working limit.
  v_loc := loc_city(transport_driver_location(p_driver, seg_start));
  if v_loc is not null and arr_from[lo] is not null and lower(btrim(v_loc)) <> lower(btrim(arr_from[lo])) then
    need_min := transport_deadhead_min(cand.company_id, v_loc, arr_from[lo]);
    if need_min is not null then
      work_min := work_min + need_min;
      if work_min > 720 then
        return format('Exceeds the 12-hour working period: needs %s h just to reposition %s to %s before the first trip (a 10-hour rest is required).',
                      round(need_min/60.0, 1), v_loc, arr_from[lo]);
      end if;
    end if;
  end if;

  for i in lo..hi loop
    if i > lo then
      if arr_s[i] < arr_e[i-1] then return 'Driver already has an overlapping trip at this time.'; end if;
      if arr_to[i-1] is not null and arr_from[i] is not null
         and lower(btrim(arr_to[i-1])) <> lower(btrim(arr_from[i])) then
        need_min := transport_deadhead_min(cand.company_id, arr_to[i-1], arr_from[i]);
        if need_min is null then
          return format('Repositioning route missing from Route Master (%s to %s). Add this route to enable assignment.', arr_to[i-1], arr_from[i]);
        end if;
        gap_min := extract(epoch from (arr_s[i] - arr_e[i-1])) / 60;
        -- A pickup AT Jeddah Airport gets 30 minutes of grace: the passenger
        -- is still clearing immigration and collecting luggage, so a driver
        -- is not late until 30 minutes past the scheduled time. This widens
        -- what counts as enough time to reposition into it; the error still
        -- reports the true schedule gap, not the padded one.
        avail_min := gap_min;
        if arr_from[i] ilike '%airport%' and arr_from[i] ilike '%jeddah%' then
          avail_min := avail_min + 30;
        end if;
        if avail_min < need_min then
          return format('Not enough repositioning time: needs %s min to return %s to %s, only %s min available between trips.',
                        need_min, arr_to[i-1], arr_from[i], round(gap_min));
        end if;
        work_min := work_min + need_min;
        if work_min > 720 then
          return 'Exceeds the 12-hour maximum working period including repositioning (a 10-hour continuous rest is required).';
        end if;
      end if;
    end if;
    work_min := work_min + extract(epoch from (arr_e[i] - arr_s[i])) / 60;
    if work_min > 720 then
      return 'Exceeds the 12-hour maximum working period including repositioning (a 10-hour continuous rest is required).';
    end if;
    span_min := extract(epoch from (arr_e[i] - seg_start)) / 60;
    if span_min > 840 then
      return 'Exceeds the 14-hour maximum duty span (a 10-hour continuous rest is required).';
    end if;
  end loop;
  return null;
end $function$;

-- ── post-conditions ────────────────────────────────────────────────────────
do $chk$
declare v_reason text; v_muzammil uuid; v_candidate uuid;
begin
  -- The pattern that decides whether a leg gets the grace: "Jeddah Airport"
  -- matches, "Jeddah Hotel" and "Makkah Hotel" (no "airport") do not.
  if not ('Jeddah Airport' ilike '%airport%' and 'Jeddah Airport' ilike '%jeddah%') then
    raise exception '388: the grace pattern does not match Jeddah Airport itself';
  end if;
  if ('Jeddah Hotel' ilike '%airport%' and 'Jeddah Hotel' ilike '%jeddah%') then
    raise exception '388: the grace pattern wrongly matches Jeddah Hotel';
  end if;
  if ('Makkah Hotel' ilike '%airport%' and 'Makkah Hotel' ilike '%jeddah%') then
    raise exception '388: the grace pattern wrongly matches Makkah Hotel';
  end if;

  -- The live case that raised this migration: Muzammil's 75-minute gap
  -- (Madinah→Makkah ending 16:30, Jeddah Airport→Makkah Hotel starting
  -- 17:45 today) against a 90-minute Route Master requirement no longer
  -- blocks the 05:10 pickup tomorrow -- the exact error text is gone.
  select id into v_muzammil from transport_drivers where name ilike '%muzammil%' limit 1;
  select id into v_candidate from transport_trip_sched
   where trip_date = '2026-09-16' and sched_s::time = '05:10:00'
     and status not in ('cancelled') limit 1;
  if v_muzammil is not null and v_candidate is not null then
    v_reason := transport_driver_reason(v_candidate, v_muzammil);
    if v_reason = 'Not enough repositioning time: needs 90 min to return Makkah to Jeddah Airport, only 75 min available between trips.' then
      raise exception '388: the Jeddah Airport grace did not clear the live repositioning conflict';
    end if;
  else
    raise notice '388: the live trips this was written against are gone (fine on a later run) — skipped the live assertion';
  end if;

  raise notice '388 ok';
end $chk$;

commit;
