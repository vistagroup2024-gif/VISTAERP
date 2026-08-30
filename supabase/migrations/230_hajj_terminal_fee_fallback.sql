-- 230_hajj_terminal_fee_fallback.sql
-- Hajj Terminal charge: ticking "Hajj Terminal" must always add the fee, even on a
-- Jeddah-airport route that has no per-route extra rate configured (e.g. an extra
-- trip added onto a package on a route without an extra-charge row). Previously
-- transport_route_extra returned 0 for such routes, so the charge was dropped.
--
-- transport_route_extra is only ever called for the Hajj Terminal surcharge (all
-- callers guard on hajj_terminal), so it can safely fall back to a configurable
-- global fee when neither the route+vehicle nor the route-level extra is set.
insert into erp_settings (key, value) values ('hajj_terminal_fee', '90')
  on conflict (key) do nothing;

create or replace function transport_route_extra(p_company uuid, p_route uuid, p_vehicle uuid)
 returns numeric language sql stable set search_path to 'public'
as $function$
  select coalesce(
    (select extra_charge_amount from transport_route_rates
      where company_id = p_company and route_id = p_route and vehicle_id = p_vehicle
        and extra_charge_enabled and coalesce(is_active, true)
      order by created_at desc limit 1),
    (select extra_charge_amount from transport_route_rates
      where company_id = p_company and route_id = p_route
        and extra_charge_enabled and coalesce(is_active, true)
      order by created_at desc limit 1),
    nullif(get_setting('hajj_terminal_fee', '90'), '')::numeric,
    0);
$function$;
