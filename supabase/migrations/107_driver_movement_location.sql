-- ============================================================
-- VISTA ERP - 107 Driver movement log + derived location & distance
-- transport_driver_movements records repositioning without a booking. A driver's
-- current location is derived (transport_driver_location) from the latest of their
-- last movement and last finished/assigned trip drop. loc_city buckets any place
-- into a canonical city; transport_city_distance derives km between cities from
-- existing route distances (route name "A - B"). transport_log_driver_movement
-- writes a move and auto-fills the from-location & distance.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================
create table if not exists transport_driver_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  driver_id uuid not null references transport_drivers(id) on delete cascade,
  from_location text, to_location text not null, distance_km numeric,
  moved_at timestamptz not null default now(), reason text,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_driver_movements_driver on transport_driver_movements(driver_id, moved_at desc);

create or replace function public.loc_city(p text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ilike '%madinah%' or p ilike '%medina%' then 'Madinah'
    when p ilike '%makkah%' or p ilike '%mecca%' then 'Makkah'
    when p ilike '%jeddah%' or p ilike '%jed%' then 'Jeddah'
    when p ilike '%taif%' then 'Taif'
    when p ilike '%riyadh%' then 'Riyadh'
    when p ilike '%train%' then 'Train'
    else initcap(split_part(btrim(p), ' ', 1))
  end;
$$;

create or replace function public.transport_city_distance(p_a text, p_b text)
returns numeric language sql stable set search_path to 'public' as $$
  select case
    when p_a is null or p_b is null then null
    when p_a = p_b then 0
    else (
      select min(distance_km) from (
        select loc_city(split_part(name,' - ',1)) c1, loc_city(split_part(name,' - ',2)) c2, distance_km
        from transport_routes where company_id = auth_company_id() and position(' - ' in name) > 0
      ) x where (c1 = p_a and c2 = p_b) or (c1 = p_b and c2 = p_a)
    )
  end;
$$;

create or replace function public.transport_driver_location(p_driver uuid, p_asof timestamptz default now())
returns text language sql stable set search_path to 'public' as $$
  with m as (
    select to_location as loc, moved_at as ts from transport_driver_movements
    where driver_id = p_driver and moved_at <= p_asof order by moved_at desc limit 1
  ), t as (
    select coalesce(drop_location, split_part(route_label,' - ',2)) as loc,
           coalesce(scheduled_end, (trip_date + trip_time)::timestamptz) as ts
    from transport_trips
    where driver_id = p_driver and coalesce(scheduled_end, (trip_date + trip_time)::timestamptz) <= p_asof
    order by ts desc limit 1
  )
  select loc from (select loc, ts from m union all select loc, ts from t) z
  where loc is not null order by ts desc limit 1;
$$;

create or replace function public.transport_log_driver_movement(
  p_driver uuid, p_to text, p_from text default null,
  p_moved_at timestamptz default now(), p_reason text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_from text; v_id uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from transport_drivers where id = p_driver and company_id = v_company) then
    raise exception 'Driver not found'; end if;
  v_from := coalesce(nullif(p_from,''), transport_driver_location(p_driver, p_moved_at));
  insert into transport_driver_movements(company_id, driver_id, from_location, to_location,
    distance_km, moved_at, reason, created_by)
  values (v_company, p_driver, v_from, p_to,
    transport_city_distance(loc_city(v_from), loc_city(p_to)), p_moved_at, nullif(p_reason,''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.transport_log_driver_movement(uuid, text, text, timestamptz, text) from anon, public;
