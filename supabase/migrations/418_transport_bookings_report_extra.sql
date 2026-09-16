-- Transport Bookings Report — companion to the existing transport_reports()
-- (unchanged, still the summary/by_agent/by_route/by_vehicle/by_driver/daily
-- source for /transport/reports). This adds the three things the original
-- reporting spec asked for that transport_reports() didn't carry:
--   - country-wise summary: transport_bookings.nationality is the passenger's
--     own country, already populated on 421 of 469 real bookings — this is
--     "which countries our pilgrims come from", not the B2B agent's own
--     country (b2b_agents.country), which is a different question already
--     answered by by_agent.
--   - a month-wise trend, alongside the existing day-wise one.
--   - a trip-level detail table (customer, contact, travel date, route, car,
--     amount, status), which transport_reports() never listed row by row.
-- Kept as its own invoker RPC (SECURITY INVOKER by omission, STABLE SQL,
-- explicit p_company) rather than folding into transport_reports(), which is
-- SECURITY DEFINER — new reports in this ERP are written invoker so RLS
-- reaches them directly, per the house convention; transport_reports()'s own
-- definer-ness is pre-existing and untouched.
create or replace function public.report_transport_bookings_extra(p_company uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
with bk as (
  select * from transport_bookings
  where company_id = p_company and coalesce(booking_date, created_at::date) between p_from and p_to
),
tp as (
  select t.*, r.name as rname, coalesce(bk2.passenger_name,'—') as passenger_name, bk2.whatsapp, bk2.mobile
  from transport_trips t
  left join transport_routes r on r.id = t.route_id
  left join transport_bookings bk2 on bk2.id = t.booking_id
  where t.company_id = p_company and t.trip_date between p_from and p_to
)
select jsonb_build_object(
  'by_country', coalesce((
    select jsonb_agg(x) from (
      select coalesce(nullif(nationality, ''), 'Unspecified') as country, count(*) as bookings, coalesce(sum(total_amount),0) as revenue
      from bk where status <> 'cancelled' group by 1 order by revenue desc
    ) x), '[]'::jsonb),
  'monthly', coalesce((
    select jsonb_agg(x) from (
      select to_char(trip_date, 'YYYY-MM') as month, count(*) as trips,
        coalesce(sum(sell_rate) filter (where status <> 'cancelled'), 0) as revenue
      from tp group by 1 order by 1
    ) x), '[]'::jsonb),
  'trips', coalesce((
    select jsonb_agg(x order by x.trip_date, x.trip_time) from (
      select passenger_name as customer, coalesce(whatsapp, mobile) as contact, trip_date, trip_time, rname as route,
        (select v.name from transport_vehicles v where v.id = tp.vehicle_id) as car,
        sell_rate as amount, status
      from tp
    ) x), '[]'::jsonb)
);
$function$;

revoke all on function public.report_transport_bookings_extra(uuid, date, date) from public, anon;
grant execute on function public.report_transport_bookings_extra(uuid, date, date) to authenticated;

do $chk$
declare
  v_company uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_extra jsonb;
  v_main jsonb;
  v_country_rev numeric;
  v_main_rev numeric;
  v_monthly_trips numeric;
  v_main_trips numeric;
  v_trips_count int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select public.report_transport_bookings_extra(v_company, '2000-01-01', current_date) into v_extra;
  select public.transport_reports('2000-01-01', current_date) into v_main;

  select coalesce(sum((r->>'revenue')::numeric),0) into v_country_rev from jsonb_array_elements(v_extra->'by_country') r;
  v_main_rev := (v_main->'summary'->>'revenue')::numeric;
  if abs(v_country_rev - v_main_rev) > 0.01 then
    raise exception 'by_country revenue % does not match summary revenue %', v_country_rev, v_main_rev;
  end if;

  select coalesce(sum((r->>'trips')::numeric),0) into v_monthly_trips from jsonb_array_elements(v_extra->'monthly') r;
  v_main_trips := (v_main->'summary'->>'trips')::numeric;
  if v_monthly_trips <> v_main_trips then
    raise exception 'monthly trips % does not match summary trips %', v_monthly_trips, v_main_trips;
  end if;

  select jsonb_array_length(v_extra->'trips') into v_trips_count;
  if v_trips_count <> v_main_trips then
    raise exception 'trips detail count % does not match summary trips %', v_trips_count, v_main_trips;
  end if;

  raise notice 'self-check passed: country_rev=%, monthly_trips=%, trips_detail=%', v_country_rev, v_monthly_trips, v_trips_count;
end;
$chk$;
