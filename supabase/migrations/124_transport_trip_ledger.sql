-- 124 Admin transport trip ledger RPC: one row per trip with supplier (if outsourced),
-- customer (agent/direct/cash), Haji, booked car, in-house driver, route, trip fare,
-- supplier amount and trip date. Company-scoped, staff-only. Gated in the app by the
-- new 'transport.trip_ledger' staff permission. (Applied via Supabase MCP.)
create or replace function public.transport_trip_ledger(p_from date, p_to date)
returns table(
  trip_date date, trip_time text, supplier_name text, customer_name text, haji_name text,
  booking_car text, driver_name text, route text, trip_fare numeric, supplier_amount numeric
) language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  return query
  select ts.trip_date, to_char(ts.trip_time,'HH24:MI') as trip_time,
    ven.name as supplier_name,
    coalesce(ag.name, nullif(initcap(b.booking_type),''), 'Direct') as customer_name,
    b.passenger_name as haji_name,
    coalesce(veh.name, rveh.name) as booking_car,
    dr.name as driver_name,
    coalesce(ts.route_name, ts.route_label) as route,
    t.sell_rate as trip_fare,
    case when ts.vendor_id is not null or coalesce(ts.is_outsourced, false) then t.vendor_cost else null end as supplier_amount
  from transport_trip_sched ts
  join transport_bookings b on b.id = ts.booking_id
  left join transport_trips t on t.id = ts.id
  left join transport_vendors ven on ven.id = ts.vendor_id
  left join transport_drivers dr on dr.id = ts.driver_id
  left join transport_vehicles veh on veh.id = ts.vehicle_id
  left join transport_vehicles rveh on rveh.id = ts.requested_vehicle_id
  left join parties ag on ag.id = b.agent_id
  where ts.company_id = auth_company_id() and b.status <> 'cancelled'
    and ts.trip_date between p_from and p_to
  order by ts.trip_date, ts.trip_time;
end $function$;
revoke all on function public.transport_trip_ledger(date, date) from anon;
