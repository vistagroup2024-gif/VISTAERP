-- 169 Visa Invoices sort order + Trip Ledger cash-only-for-cash-bookings.
--
-- 1. visa_invoice_ledger now orders like the Visa Groups list (newest first by
--    created_at) instead of by visa date, so the two screens line up.
-- 2. transport_trip_ledger shows Cash Received ONLY for cash bookings; a non-cash
--    booking (agent no-cash, card, bank transfer) shows blank even if a stray
--    cash figure exists on the trip.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

create or replace function public.visa_invoice_ledger(p_from date, p_to date)
returns table(group_id uuid, visa_date date, company text, customer text, group_name text, group_no text, visa_type text, total_nights integer, pax integer, invoice_created boolean)
language sql stable security definer set search_path to 'public' as $function$
  select g.id,
         coalesce(g.visa_issued_at::date, g.group_date) as visa_date,
         gc.name as company,
         coalesce(a.agency_name, p.name) as customer,
         g.group_name, g.group_no, g.visa_type,
         case when g.covered_from is not null and g.covered_to is not null
              then (g.covered_to - g.covered_from) else null end as total_nights,
         g.pax,
         coalesce(g.invoice_created, false) as invoice_created
  from umrah_groups g
  left join group_companies gc on gc.id = g.group_company_id
  left join b2b_agents a on a.agent_party_id = g.agent_id
  left join parties p on p.id = g.agent_id
  where g.company_id = auth_company_id()
    and coalesce(g.workflow_status,'pending') <> 'rejected'
    and coalesce(g.visa_issued_at::date, g.group_date) between p_from and p_to
  order by g.created_at desc;
$function$;

create or replace function public.transport_trip_ledger(p_from date, p_to date)
returns table(trip_id uuid, trip_date date, trip_time text, supplier_name text, customer_name text, haji_name text, booking_car text, driver_name text, route text, trip_fare numeric, supplier_amount numeric, cash_received numeric, invoice_created boolean)
language plpgsql stable security definer set search_path to 'public' as $function$
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
    -- Cash Received only for cash bookings; non-cash (agent no-cash, card, bank) shows blank.
    case when coalesce(b.payment_method, case when b.agent_id is null then 'cash' else 'no_cash' end) = 'cash'
         then t.cash_received else null end as cash_received,
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
