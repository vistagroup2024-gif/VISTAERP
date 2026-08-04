-- ============================================================
-- VISTA ERP - 108 Driver dashboard board feed
-- transport_driver_board(): one row per active driver with derived location, live
-- status (on_trip/available/resting/off), the trip in progress and when they free,
-- the next trip, and today's load. Powers the Driver Dashboard page.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================
create or replace function public.transport_driver_board()
returns table(
  driver_id uuid, name text, mobile text, status text, vehicle text,
  location text, city text, driver_status text,
  current_trip jsonb, next_trip jsonb, today_total int, today_done int, today_remaining int
) language sql stable security definer set search_path to 'public' as $$
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
      and t.status in ('assigned','on_route') and coalesce(t.scheduled_start,(t.trip_date+t.trip_time)::timestamptz) >= now()
    order by t.driver_id, coalesce(t.scheduled_start,(t.trip_date+t.trip_time)::timestamptz)
  ),
  tod as (
    select driver_id, count(*)::int total,
      count(*) filter (where status='completed')::int done,
      count(*) filter (where status not in ('completed','cancelled'))::int remaining
    from transport_trips where company_id = auth_company_id() and trip_date = current_date
    group by driver_id
  )
  select dr.id, dr.name, dr.mobile, dr.status, dr.vehicle,
    transport_driver_location(dr.id) as location, loc_city(transport_driver_location(dr.id)) as city,
    case
      when cur.id is not null then 'on_trip'
      when exists (select 1 from transport_trips t where t.driver_id = dr.id and t.status='completed'
                    and coalesce(t.scheduled_end,(t.trip_date+t.trip_time)::timestamptz) > now() - interval '10 hours') then 'resting'
      when dr.status <> 'active' then 'off'
      else 'available'
    end as driver_status,
    case when cur.id is not null then jsonb_build_object('trip_id',cur.id,'route',coalesce(cur.route_name,cur.route_label),
      'started',cur.scheduled_start,'free_at',cur.scheduled_end,'drop',cur.drop_location,'status',cur.status) end,
    case when nxt.id is not null then jsonb_build_object('trip_id',nxt.id,'route',coalesce(nxt.route_name,nxt.route_label),
      'date',nxt.trip_date,'time',to_char(nxt.trip_time,'HH24:MI'),'start',nxt.scheduled_start,'pickup',nxt.pickup_location) end,
    coalesce(tod.total,0), coalesce(tod.done,0), coalesce(tod.remaining,0)
  from dr left join cur on cur.driver_id = dr.id left join nxt on nxt.driver_id = dr.id left join tod on tod.driver_id = dr.id
  order by (cur.id is not null) desc, dr.name;
$$;
revoke all on function public.transport_driver_board() from anon;
