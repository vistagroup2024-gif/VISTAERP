-- Also count the INITIAL reposition (from where the driver currently is to the first
-- trip's origin) toward the 12h working limit. e.g. a driver standing in Makkah given a
-- Madinah trip must first drive Makkah->Madinah (5h) -- that drive is real work.
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
  seg_start timestamptz; work_min numeric := 0; span_min numeric; gap_min numeric;
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
        if gap_min < need_min then
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
