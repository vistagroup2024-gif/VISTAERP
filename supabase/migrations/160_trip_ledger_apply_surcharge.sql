-- 160 Trip Ledger reflects the customer surcharge (Cash / Umrah-package walk-ins).
-- The per-trip fare is scaled by the booking's (net + surcharge) / sell ratio so the
-- ledger's trip fares add up to the booking total (discount reduces, surcharge adds).
-- The Hajj-terminal route extra is added on top and is never discounted/surcharged.
-- NOTE: full runnable SQL below (not yet applied via MCP — apply on next migration run).
drop function if exists public.transport_trip_ledger(date, date);
create function public.transport_trip_ledger(p_from date, p_to date)
returns table(
  trip_id uuid, trip_date date, trip_time text, supplier_name text, customer_name text, haji_name text,
  booking_car text, driver_name text, route text, trip_fare numeric, supplier_amount numeric,
  cash_received numeric, invoice_created boolean
) language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  return query
  select ts.id as trip_id, ts.trip_date, to_char(ts.trip_time,'HH24:MI') as trip_time,
    ven.name as supplier_name,
    coalesce(ag.name, nullif(initcap(b.booking_type),''), 'Direct') as customer_name,
    b.passenger_name as haji_name,
    coalesce(veh.name, rveh.name) as booking_car,
    dr.name as driver_name,
    coalesce(ts.route_name, ts.route_label) as route,
    round(coalesce(t.sell_rate,0)
      * (case when coalesce(b.sell_amount,0) > 0
              then (coalesce(b.net_amount, b.sell_amount) + coalesce(b.surcharge_amount,0)) / b.sell_amount
              else 1 end), 2)
      + case when coalesce(ts.hajj_terminal,false) then coalesce(ex.amt,0) else 0 end as trip_fare,
    case when ts.vendor_id is not null or coalesce(ts.is_outsourced, false) then t.vendor_cost else null end as supplier_amount,
    t.cash_received,
    coalesce(t.invoice_created, false) as invoice_created
  from transport_trip_sched ts
  join transport_bookings b on b.id = ts.booking_id
  left join transport_trips t on t.id = ts.id
  left join transport_vendors ven on ven.id = ts.vendor_id
  left join transport_drivers dr on dr.id = ts.driver_id
  left join transport_vehicles veh on veh.id = ts.vehicle_id
  left join transport_vehicles rveh on rveh.id = ts.requested_vehicle_id
  left join parties ag on ag.id = b.agent_id
  left join lateral (
    select coalesce(
      (select rr.extra_charge_amount from transport_route_rates rr
        where rr.route_id = ts.route_id and rr.vehicle_id = coalesce(ts.vehicle_id, ts.requested_vehicle_id)
          and rr.extra_charge_enabled limit 1),
      (select rr.extra_charge_amount from transport_route_rates rr
        where rr.route_id = ts.route_id and rr.vehicle_id is null and rr.extra_charge_enabled limit 1),
      0) as amt
  ) ex on true
  where ts.company_id = auth_company_id() and b.status <> 'cancelled'
    and ts.trip_date between p_from and p_to
  order by ts.trip_date, ts.trip_time;
end $function$;
revoke all on function public.transport_trip_ledger(date, date) from anon;
