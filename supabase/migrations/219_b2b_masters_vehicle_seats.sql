-- 219_b2b_masters_vehicle_seats.sql
-- Fix: agent New Transport Booking form could not size a vehicle mix.
--
-- When a trip's pax exceed one vehicle, the booking form asks the user to pick
-- the vehicles for that trip and validates that the chosen vehicles seat everyone.
-- That sizing uses each vehicle's `seating_capacity`. The staff form loads it, but
-- the agent portal's b2b_transport_masters() returned only (id, name) for
-- vehicles, so every vehicle read as "? seats" / 0 seats and the agent could never
-- satisfy "Seats 0 / N needed — not enough".
--
-- Add seating_capacity to the vehicles list. Everything else is unchanged.
create or replace function b2b_transport_masters(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a b2b_agents%rowtype; v jsonb; v_party uuid;
begin
  a := b2b_agent_of(p_token);
  v_party := coalesce(a.agent_party_id, a.id);
  select jsonb_build_object(
    'routes', coalesce((select jsonb_agg(x) from (select id, name, is_airport from transport_routes where company_id = a.company_id and is_active order by name) x), '[]'::jsonb),
    'vehicles', coalesce((select jsonb_agg(x) from (select id, name, seating_capacity from transport_vehicles where company_id = a.company_id and is_active order by sort_order, name) x), '[]'::jsonb),
    'rates', coalesce((select jsonb_agg(x) from (
       select r.id as route_id, ve.id as vehicle_id,
         transport_agent_rate(a.company_id, v_party, r.id, ve.id, current_date) as sell_rate
       from transport_routes r cross join transport_vehicles ve
       where r.company_id = a.company_id and r.is_active and ve.company_id = a.company_id and ve.is_active
         and transport_agent_rate(a.company_id, v_party, r.id, ve.id, current_date) is not null
    ) x), '[]'::jsonb),
    'packagePrices', coalesce((select jsonb_agg(x) from (
       select distinct pp.package_id, pp.vehicle_id,
         transport_package_price(a.company_id, v_party, pp.package_id, pp.vehicle_id) as price
       from transport_package_prices pp where pp.company_id = a.company_id) x), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(p) from (
       select jsonb_build_object('id', pk.id, 'name', pk.name, 'price', pk.price, 'package_type', pk.package_type,
         'legs', coalesce((select jsonb_agg(l order by l.seq) from (
            select seq, route_id, label, vehicle_id from transport_package_legs where package_id = pk.id) l), '[]'::jsonb)) as p
       from transport_packages pk where pk.company_id = a.company_id and pk.is_active order by pk.name) q), '[]'::jsonb)
  ) into v;
  return v;
end $function$;
