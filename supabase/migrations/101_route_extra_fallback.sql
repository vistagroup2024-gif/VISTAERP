-- ============================================================
-- VISTA ERP - 101 Route extra-charge (Hajj Terminal) route-level fallback
-- The Hajj Terminal / route surcharge is a fixed per-route amount but is stored
-- per route+vehicle in transport_route_rates. A package's vehicle may have no
-- extra-charge row for a given route, so the exact route+vehicle lookup returned
-- 0 and the surcharge was silently dropped (e.g. TRP-000060: Jeddah Airport ->
-- Makkah leg with Hajj Terminal ticked but the package vehicle had no extra row).
-- Fall back to the most recent enabled extra on that route (any vehicle) when the
-- exact pair has none, so the surcharge applies regardless of the chosen vehicle.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================
create or replace function public.transport_route_extra(p_company uuid, p_route uuid, p_vehicle uuid)
returns numeric language sql stable set search_path to 'public' as $function$
  select coalesce(
    (select extra_charge_amount from transport_route_rates
      where company_id = p_company and route_id = p_route and vehicle_id = p_vehicle
        and extra_charge_enabled and coalesce(is_active, true)
      order by created_at desc limit 1),
    (select extra_charge_amount from transport_route_rates
      where company_id = p_company and route_id = p_route
        and extra_charge_enabled and coalesce(is_active, true)
      order by created_at desc limit 1),
    0);
$function$;
