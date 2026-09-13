-- Rollback of 374 — restores the route-name location rule, the board that
-- counts any open trip as current, and completion routines that close nothing
-- else.
--
-- THE TWO TRIPS 374 CLOSED STAY CLOSED. They were on_route / picked_up while
-- the driver had completed later trips, and the audit rows
-- (action = transport_trip_autoclosed, reason beginning "migration 374")
-- record exactly which. Reopening them would put a driver back on a trip that
-- ended days ago; do it by hand from the audit log if that is really wanted.

begin;

create or replace function public.transport_driver_current_location(p_driver uuid)
returns text language sql stable security definer set search_path to 'public' as $function$
  with m as (
    select loc_city(to_location) as loc, moved_at as ts, moved_at as tie
    from transport_driver_movements where driver_id = p_driver order by moved_at desc limit 1
  ), t as (
    select loc_city(split_part(route_label,' - ',2)) as loc,
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
returns text language sql stable set search_path to 'public' as $function$
  with m as (
    select loc_city(to_location) as loc, moved_at as ts, 1 as pri from transport_driver_movements
    where driver_id = p_driver and moved_at <= p_asof order by moved_at desc limit 1
  ), t as (
    select loc_city(split_part(route_label,' - ',2)) as loc,
           coalesce(scheduled_end, (trip_date + trip_time)::timestamptz) as ts, 0 as pri
    from transport_trips
    where driver_id = p_driver and coalesce(scheduled_end, (trip_date + trip_time)::timestamptz) <= p_asof
    order by ts desc limit 1
  )
  select loc from (select loc, ts, pri from m union all select loc, ts, pri from t) z
  where loc is not null order by ts desc, pri desc limit 1;
$function$;

create or replace function public.transport_complete_trip(p_trip uuid, p_cash numeric default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_company uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update transport_trips set status = 'completed', cash_received = p_cash, completed_at = coalesce(completed_at, now())
  where id = p_trip and company_id = v_company;
  if not found then raise exception 'Trip not found'; end if;
end $function$;

create or replace function public.transport_set_trip_status(p_trip uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $function$
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
end $function$;

create or replace function public.transport_driver_portal_status(p_token text, p_trip uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare s transport_sessions%rowtype;
begin
  s := transport_session_of(p_token);
  if s.kind <> 'driver' then raise exception 'Not a driver session'; end if;
  if p_status not in ('on_route','picked_up','completed') then raise exception 'Invalid status'; end if;
  update transport_trips set status = p_status,
    completed_at = case when p_status='completed' then coalesce(completed_at, now()) else completed_at end
  where id = p_trip and company_id = s.company_id and driver_id = s.subject_id;
  if not found then raise exception 'Trip not found'; end if;
end $function$;

create or replace function public.transport_driver_board()
returns table(driver_id uuid, name text, mobile text, status text, vehicle text, location text, city text, driver_status text, current_trip jsonb, next_trip jsonb, today_total integer, today_done integer, today_remaining integer)
language sql stable security definer set search_path to 'public' as $function$
  with dr as (
    select d.id, d.name, d.mobile, d.status, v.name as vehicle
    from transport_drivers d left join transport_vehicles v on v.id = d.vehicle_id
    where d.company_id = auth_company_id()
  ),
  cur as (
    select distinct on (t.driver_id) t.driver_id, t.id, t.route_label, r.name as route_name,
      t.scheduled_start, t.scheduled_end, t.drop_location, t.status, t.trip_time
    from transport_trips t left join transport_routes r on r.id = t.route_id
    where t.company_id = auth_company_id() and t.status in ('on_route','picked_up')
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
    case when cur.id is not null then 'on_trip'
         when coalesce(transport_driver_rest_until(dr.id), now()) > now() then 'resting'
         when dr.status <> 'active' then 'off' else 'available' end as driver_status,
    case when cur.id is not null then jsonb_build_object('trip_id', cur.id, 'route', coalesce(cur.route_name, cur.route_label),
      'started', cur.scheduled_start, 'free_at', cur.scheduled_end, 'drop', cur.drop_location, 'status', cur.status) end as current_trip,
    case when nxt.id is not null then jsonb_build_object('trip_id', nxt.id, 'route', coalesce(nxt.route_name, nxt.route_label),
      'date', nxt.trip_date, 'time', to_char(nxt.trip_time,'HH24:MI'), 'start', nxt.scheduled_start, 'pickup', nxt.pickup_location) end as next_trip,
    coalesce(tod.total,0), coalesce(tod.done,0), coalesce(tod.remaining,0)
  from dr left join cur on cur.driver_id = dr.id left join nxt on nxt.driver_id = dr.id left join tod on tod.driver_id = dr.id
  order by (cur.id is not null) desc, dr.name;
$function$;

drop function if exists public.transport_close_earlier_open_trips(uuid);
drop function if exists public.transport_trip_end_city(uuid);
drop function if exists public.loc_city_known(text);

do $chk$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname in ('transport_close_earlier_open_trips','transport_trip_end_city','loc_city_known')) then
    raise exception '374 rollback: a helper is still there';
  end if;
  raise notice '374 rollback ok';
end
$chk$;

commit;
