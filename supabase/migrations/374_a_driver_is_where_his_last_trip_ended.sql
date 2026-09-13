-- A driver is where his last trip ended, and a driver cannot be on two trips.
--
-- TWO THINGS THE DRIVER DASHBOARD GOT WRONG ABOUT RAHAT NAZAR, and both are
-- rules rather than data errors:
--
-- 1. "ON TRIP" THREE DAYS AFTER THE TRIP. The board calls a driver on_trip if
--    ANY of his trips is on_route or picked_up — however old. Rahat's
--    TRP-000304 (Makkah → Jeddah Airport, 10 Sep, 23:30) was never pressed
--    to completed, and TRP-000225 from 18 AUGUST is still picked_up; he has
--    completed six trips since. A driver cannot be on two trips at once, so a
--    later completed trip is proof the earlier one ended. Completing a trip
--    now CLOSES any earlier trip of the same driver still open (completed_at =
--    its scheduled end, audit row transport_trip_autoclosed), the board only
--    counts an open trip as current while it is less than a day past its end,
--    and the two stuck trips are closed here the same way.
--
-- 2. "TAIF" AFTER DROPPING AT A MAKKAH HOTEL. The location rule read the
--    SECOND HALF OF THE ROUTE NAME — split_part(route_label, ' - ', 2) — and
--    nothing else. His last trip was "Makkah - Taif Ziarat": a ziarat is a
--    round trip, pickup ANJUM HOTEL, drop ANJUM HOTEL, back in Makkah. The
--    route name says Taif, so the board said Taif. transport_trip_end_city()
--    replaces that with, in order: a city named in the DROP location; for a
--    ziarat or a route whose two ends are the same, the city he started from;
--    the route's to_location; the route name's second half; and, failing all
--    of those, the pickup city — he has not been shown to move.
--
-- loc_city() stays as it was because the board and the movements log use its
-- first-word fallback; the new loc_city_known() answers ONLY when it can name
-- one of the cities, so "ANJUM HOTEL" is unknown rather than "Anjum".
--
-- Both location resolvers use the one helper. transport_driver_location
-- (the as-of variant, used by repositioning and planning) keeps counting
-- trips by their scheduled end so "where will he be at 6pm" still works, but
-- now leaves cancelled trips out.

begin;

-- ---------------------------------------------------------------------------
-- 1. Cities we can actually name.
-- ---------------------------------------------------------------------------
create or replace function public.loc_city_known(p text)
returns text
language sql immutable
set search_path to 'public'
as $function$
  select case
    when p is null or btrim(p) = '' then null
    when p ilike '%madinah%' or p ilike '%medina%' or p ilike '%madina%' then 'Madinah'
    when p ilike '%makkah%' or p ilike '%mecca%' or p ilike '%makka%' then 'Makkah'
    when p ilike '%jeddah%' or p ilike '%jed%' then 'Jeddah'
    when p ilike '%taif%' then 'Taif'
    when p ilike '%riyadh%' then 'Riyadh'
    when p ilike '%train%' then 'Train'
    else null
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Where a trip leaves its driver.
-- ---------------------------------------------------------------------------
create or replace function public.transport_trip_end_city(p_trip uuid)
returns text
language sql stable
set search_path to 'public'
as $function$
  select coalesce(
    -- the drop location names a city: that is where he is
    loc_city_known(t.drop_location),
    -- a ziarat, or a route that starts and ends in the same place, comes back
    case when coalesce(r.name, t.route_label, '') ilike '%ziarat%'
           or (r.from_location is not null and r.to_location is not null
               and loc_city_known(r.from_location) is not null
               and loc_city_known(r.from_location) = loc_city_known(r.to_location))
         then coalesce(loc_city_known(t.pickup_location),
                       loc_city_known(r.from_location),
                       loc_city_known(split_part(t.route_label, ' - ', 1)))
    end,
    -- the route's own destination
    loc_city_known(r.to_location),
    loc_city_known(split_part(t.route_label, ' - ', 2)),
    -- nothing says he moved
    loc_city_known(t.pickup_location),
    loc_city_known(r.from_location),
    loc_city_known(split_part(t.route_label, ' - ', 1)))
  from transport_trips t
  left join transport_routes r on r.id = t.route_id
  where t.id = p_trip;
$function$;

create or replace function public.transport_driver_current_location(p_driver uuid)
returns text
language sql stable security definer
set search_path to 'public'
as $function$
  with m as (
    select loc_city(to_location) as loc, moved_at as ts, moved_at as tie
    from transport_driver_movements where driver_id = p_driver order by moved_at desc limit 1
  ), t as (
    select transport_trip_end_city(id) as loc,
           coalesce(completed_at, scheduled_end, (trip_date + trip_time)::timestamptz) as ts,
           coalesce(scheduled_start, (trip_date + trip_time)::timestamptz) as tie
    from transport_trips where driver_id = p_driver and status = 'completed'
    order by coalesce(completed_at, scheduled_end, (trip_date + trip_time)::timestamptz) desc,
             coalesce(scheduled_start, (trip_date + trip_time)::timestamptz) desc
    limit 1
  )
  select loc from (select loc, ts, tie from m union all select loc, ts, tie from t) z
  where loc is not null order by ts desc, tie desc limit 1;
$function$;

create or replace function public.transport_driver_location(p_driver uuid, p_asof timestamp with time zone default now())
returns text
language sql stable
set search_path to 'public'
as $function$
  with m as (
    select loc_city(to_location) as loc, moved_at as ts, 1 as pri from transport_driver_movements
    where driver_id = p_driver and moved_at <= p_asof order by moved_at desc limit 1
  ), t as (
    select transport_trip_end_city(id) as loc,
           coalesce(scheduled_end, (trip_date + trip_time)::timestamptz) as ts, 0 as pri
    from transport_trips
    where driver_id = p_driver and status <> 'cancelled'
      and coalesce(scheduled_end, (trip_date + trip_time)::timestamptz) <= p_asof
    order by ts desc limit 1
  )
  select loc from (select loc, ts, pri from m union all select loc, ts, pri from t) z
  where loc is not null order by ts desc, pri desc limit 1;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Completing a trip closes any earlier trip of the same driver still open.
-- ---------------------------------------------------------------------------
create or replace function public.transport_close_earlier_open_trips(p_trip uuid)
returns integer
language plpgsql security definer
set search_path to 'public'
as $function$
declare t transport_trips%rowtype; v_n int := 0; r record;
begin
  select * into t from transport_trips where id = p_trip;
  if not found or t.driver_id is null then return 0; end if;
  for r in
    select o.id, o.status, o.scheduled_end, o.trip_date, o.trip_time
      from transport_trips o
     where o.driver_id = t.driver_id and o.id <> t.id
       and o.status in ('on_route', 'picked_up')
       and coalesce(o.scheduled_start, (o.trip_date + o.trip_time)::timestamptz)
           < coalesce(t.scheduled_start, (t.trip_date + t.trip_time)::timestamptz)
  loop
    update transport_trips
       set status = 'completed',
           completed_at = coalesce(completed_at, r.scheduled_end, (r.trip_date + r.trip_time)::timestamptz, now())
     where id = r.id;
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (t.company_id, auth.uid(), 'transport_trip_autoclosed', 'transport_trips', r.id,
            jsonb_build_object('was', r.status, 'closed_by_trip', t.id,
                               'reason', 'the driver completed a later trip; he cannot have still been on this one'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
revoke all on function public.transport_close_earlier_open_trips(uuid) from public, anon, authenticated;

create or replace function public.transport_complete_trip(p_trip uuid, p_cash numeric default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update transport_trips set status = 'completed', cash_received = p_cash, completed_at = coalesce(completed_at, now())
  where id = p_trip and company_id = v_company;
  if not found then raise exception 'Trip not found'; end if;
  perform transport_close_earlier_open_trips(p_trip);
end $function$;

create or replace function public.transport_set_trip_status(p_trip uuid, p_status text)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_status not in ('pending','assigned','on_route','picked_up','completed','cancelled','outsource_required','outsourced') then
    raise exception 'Invalid status';
  end if;
  update transport_trips set status = p_status,
    completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else completed_at end
  where id = p_trip and company_id = v_company;
  if not found then raise exception 'Trip not found'; end if;
  if p_status = 'completed' then perform transport_close_earlier_open_trips(p_trip); end if;
end $function$;

create or replace function public.transport_driver_portal_status(p_token text, p_trip uuid, p_status text)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare s transport_sessions%rowtype;
begin
  s := transport_session_of(p_token);
  if s.kind <> 'driver' then raise exception 'Not a driver session'; end if;
  if p_status not in ('on_route','picked_up','completed') then raise exception 'Invalid status'; end if;
  update transport_trips set status = p_status,
    completed_at = case when p_status='completed' then coalesce(completed_at, now()) else completed_at end
  where id = p_trip and company_id = s.company_id and driver_id = s.subject_id;
  if not found then raise exception 'Trip not found'; end if;
  if p_status = 'completed' then perform transport_close_earlier_open_trips(p_trip); end if;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. The board: an open trip is "current" only while it is recent.
-- ---------------------------------------------------------------------------
create or replace function public.transport_driver_board()
returns table(driver_id uuid, name text, mobile text, status text, vehicle text, location text, city text,
              driver_status text, current_trip jsonb, next_trip jsonb, today_total integer, today_done integer, today_remaining integer)
language sql stable security definer
set search_path to 'public'
as $function$
  with dr as (
    select d.id, d.name, d.mobile, d.status, v.name as vehicle
    from transport_drivers d
    left join transport_vehicles v on v.id = d.vehicle_id
    where d.company_id = auth_company_id()
  ),
  cur as (
    -- on the road now: on_route / picked_up, and not more than a day past the
    -- time it was due to end. An older one is a trip nobody pressed Complete on,
    -- not a driver who has been driving for three days.
    select distinct on (t.driver_id) t.driver_id, t.id, t.route_label, r.name as route_name,
      t.scheduled_start, t.scheduled_end, t.drop_location, t.status, t.trip_time
    from transport_trips t left join transport_routes r on r.id = t.route_id
    where t.company_id = auth_company_id() and t.status in ('on_route','picked_up')
      and coalesce(t.scheduled_end, (t.trip_date + t.trip_time)::timestamptz, t.trip_date::timestamptz) >= now() - interval '24 hours'
    order by t.driver_id, t.scheduled_start
  ),
  nxt as (
    select distinct on (t.driver_id) t.driver_id, t.id, t.route_label, r.name as route_name,
      t.trip_date, t.trip_time, t.scheduled_start, t.pickup_location
    from transport_trips t left join transport_routes r on r.id = t.route_id
    where t.company_id = auth_company_id()
      and t.status in ('assigned','on_route') and coalesce(t.scheduled_start, (t.trip_date+t.trip_time)::timestamptz) >= now()
    order by t.driver_id, coalesce(t.scheduled_start, (t.trip_date+t.trip_time)::timestamptz)
  ),
  tod as (
    select driver_id, count(*)::int total,
      count(*) filter (where status='completed')::int done,
      count(*) filter (where status not in ('completed','cancelled'))::int remaining
    from transport_trips where company_id = auth_company_id() and trip_date = current_date
    group by driver_id
  )
  select dr.id, dr.name, dr.mobile, dr.status, dr.vehicle,
    transport_driver_current_location(dr.id) as location,
    loc_city(transport_driver_current_location(dr.id)) as city,
    case
      when cur.id is not null then 'on_trip'
      when coalesce(transport_driver_rest_until(dr.id), now()) > now() then 'resting'
      when dr.status <> 'active' then 'off'
      else 'available'
    end as driver_status,
    case when cur.id is not null then jsonb_build_object(
      'trip_id', cur.id, 'route', coalesce(cur.route_name, cur.route_label),
      'started', cur.scheduled_start, 'free_at', cur.scheduled_end, 'drop', cur.drop_location, 'status', cur.status) end as current_trip,
    case when nxt.id is not null then jsonb_build_object(
      'trip_id', nxt.id, 'route', coalesce(nxt.route_name, nxt.route_label),
      'date', nxt.trip_date, 'time', to_char(nxt.trip_time,'HH24:MI'), 'start', nxt.scheduled_start, 'pickup', nxt.pickup_location) end as next_trip,
    coalesce(tod.total,0), coalesce(tod.done,0), coalesce(tod.remaining,0)
  from dr
  left join cur on cur.driver_id = dr.id
  left join nxt on nxt.driver_id = dr.id
  left join tod on tod.driver_id = dr.id
  order by (cur.id is not null) desc, dr.name;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The trips already stuck: every open trip a later completed trip by the
--    same driver has overtaken. Closed the same way, with the same audit row.
-- ---------------------------------------------------------------------------
do $fix$
declare r record; v_n int := 0;
begin
  for r in
    select o.id, o.driver_id, o.status, o.company_id, o.scheduled_end, o.trip_date, o.trip_time,
           (select c.id from transport_trips c
             where c.driver_id = o.driver_id and c.status = 'completed'
               and coalesce(c.scheduled_start, (c.trip_date + c.trip_time)::timestamptz)
                   > coalesce(o.scheduled_start, (o.trip_date + o.trip_time)::timestamptz)
             order by coalesce(c.scheduled_start, (c.trip_date + c.trip_time)::timestamptz) limit 1) as later
      from transport_trips o
     where o.status in ('on_route', 'picked_up') and o.driver_id is not null
  loop
    if r.later is null then continue; end if;
    update transport_trips
       set status = 'completed',
           completed_at = coalesce(completed_at, r.scheduled_end, (r.trip_date + r.trip_time)::timestamptz, now())
     where id = r.id;
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (r.company_id, null, 'transport_trip_autoclosed', 'transport_trips', r.id,
            jsonb_build_object('was', r.status, 'closed_by_trip', r.later,
                               'reason', 'migration 374: the driver completed a later trip; he cannot have still been on this one'));
    v_n := v_n + 1;
  end loop;
  raise notice '374: closed % stuck trip(s)', v_n;
end
$fix$;

-- ---------------------------------------------------------------------------
-- 6. Post-conditions.
-- ---------------------------------------------------------------------------
do $chk$
declare v_rahat uuid; v_n int; v_loc text; v_st text; v_ziarat uuid;
begin
  -- the two cities the whole thing was about
  if loc_city_known('ANJUM HOTEL') is not null then raise exception '374: loc_city_known invented a city for ANJUM HOTEL'; end if;
  if loc_city_known('Voilet Hotel Makkah') <> 'Makkah' then raise exception '374: loc_city_known misses Makkah in a hotel name'; end if;

  select id into v_rahat from transport_drivers where name ilike '%rahat%' limit 1;
  if v_rahat is not null then
    -- the ziarat leaves him in Makkah
    select id into v_ziarat from transport_trips
     where driver_id = v_rahat and route_label ilike '%ziarat%' and status = 'completed'
     order by trip_date desc limit 1;
    if v_ziarat is not null and transport_trip_end_city(v_ziarat) <> 'Makkah' then
      raise exception '374: the ziarat trip ends in %, not Makkah', transport_trip_end_city(v_ziarat);
    end if;

    -- nothing of his is left open behind a later completed trip
    select count(*) into v_n from transport_trips o
     where o.driver_id = v_rahat and o.status in ('on_route','picked_up')
       and exists (select 1 from transport_trips c where c.driver_id = v_rahat and c.status = 'completed'
                    and coalesce(c.scheduled_start,(c.trip_date+c.trip_time)::timestamptz)
                        > coalesce(o.scheduled_start,(o.trip_date+o.trip_time)::timestamptz));
    if v_n <> 0 then raise exception '374: % of Rahat''s trips still stuck open', v_n; end if;

    -- and the board, run as staff, agrees on both counts
    perform set_config('request.jwt.claims',
      '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);
    select b.driver_status, b.location into v_st, v_loc from transport_driver_board() b where b.driver_id = v_rahat;
    if v_st = 'on_trip' then raise exception '374: the board still shows Rahat on trip'; end if;
    if v_loc <> 'Makkah' then raise exception '374: the board puts Rahat in %, not Makkah', v_loc; end if;
  end if;

  -- no stuck trip left anywhere
  select count(*) into v_n from transport_trips o
   where o.status in ('on_route','picked_up') and o.driver_id is not null
     and exists (select 1 from transport_trips c where c.driver_id = o.driver_id and c.status = 'completed'
                  and coalesce(c.scheduled_start,(c.trip_date+c.trip_time)::timestamptz)
                      > coalesce(o.scheduled_start,(o.trip_date+o.trip_time)::timestamptz));
  if v_n <> 0 then raise exception '374: % stuck trip(s) remain', v_n; end if;

  -- every close is on the record
  select count(*) into v_n from audit_log where action = 'transport_trip_autoclosed';
  if v_n < 2 then raise exception '374: expected at least the 2 known closes in the audit log, found %', v_n; end if;

  -- the closer is internal; the three completion doors call it
  if has_function_privilege('authenticated','public.transport_close_earlier_open_trips(uuid)','execute') then
    raise exception '374: the auto-closer is callable from a browser'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in ('transport_complete_trip','transport_set_trip_status','transport_driver_portal_status')
         and pg_get_functiondef(p.oid) like '%transport_close_earlier_open_trips%') <> 3 then
    raise exception '374: not every completion door closes earlier trips'; end if;

  raise notice '374 ok';
end
$chk$;

commit;
