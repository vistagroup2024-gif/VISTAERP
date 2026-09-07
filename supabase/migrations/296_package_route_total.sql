-- 296 What the package would cost booked leg by leg.
--
-- A package is sold at one price for a set of trips. Deciding that price means
-- knowing what the same trips cost individually — the discount is the gap — and
-- that number was only ever worked out on paper: open the Rate Master, find each
-- leg's route, read the rate for the vehicle, add them up, once per vehicle.
--
-- This adds them up. Each leg's rate comes from transport_agent_rate(), the same
-- function the fare chart, the booking form and the agent's own portal go
-- through, so the total is the one the customer would actually be charged.
--
-- It is also the number the package price is already spread over:
-- distribute_package_fares() prorates the package price across the trips by
-- their individual rates, so this total is that routine's `v_normal` shown
-- before the fact instead of after.
--
-- Nothing conditional is included: a route's extra charge (the Hajj Terminal
-- surcharge) is ticked per trip when it applies, so it is not part of what the
-- legs cost by default.
create or replace function public.transport_package_route_total(
  p_package uuid,
  p_agent   uuid default null,
  p_date    date default current_date)
returns jsonb language sql stable security invoker set search_path to 'public' as $$
  with co as (select auth_company_id() as id),
  legs as (
    select l.seq, l.route_id, l.vehicle_id, coalesce(l.label, r.name) as label
    from transport_package_legs l
    join transport_packages pk on pk.id = l.package_id
    left join transport_routes r on r.id = l.route_id
    where l.package_id = p_package and pk.company_id = (select id from co)
  ),
  -- Every vehicle column, against every leg. A leg that names its own vehicle
  -- keeps it — the package fixes that trip's vehicle whatever column you read.
  per as (
    select ve.id as vehicle_id, l.seq, x.rate
    from transport_vehicles ve
    cross join legs l
    cross join lateral (select transport_agent_rate((select id from co), p_agent, l.route_id,
                                                    coalesce(l.vehicle_id, ve.id), p_date) as rate) x
    where ve.company_id = (select id from co) and ve.is_active
  )
  select jsonb_build_object(
    'as_of', p_date,
    'legs', coalesce((select jsonb_agg(jsonb_build_object('seq', seq, 'label', label) order by seq) from legs), '[]'::jsonb),
    -- Keyed by vehicle so the price editor can look a row up directly. `priced`
    -- against `legs` is what says whether the total is the whole package or only
    -- the part of it that has a rate.
    'vehicles', coalesce((select jsonb_object_agg(vehicle_id, jsonb_build_object(
                            'total', total, 'priced', priced, 'legs', legs_n))
                          from (select vehicle_id, sum(rate) as total,
                                       count(rate) as priced, count(*) as legs_n
                                from per group by vehicle_id) q), '{}'::jsonb));
$$;

revoke all on function public.transport_package_route_total(uuid, uuid, date) from public, anon;
grant execute on function public.transport_package_route_total(uuid, uuid, date) to authenticated;
