-- Agent logo lockup flag: when the uploaded logo already shows the company name,
-- the voucher renders the logo ALONE (no duplicated name text beside it).
alter table b2b_agents add column if not exists logo_lockup boolean not null default false;

-- Expose logo_lockup on the agent-branded portal voucher.
create or replace function public.b2b_agent_branding(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  if a.id is null then return null; end if;
  return jsonb_build_object(
    'agency_name', a.agency_name, 'contact_person', a.contact_person, 'email', a.email,
    'mobile', a.mobile, 'address', a.address, 'logo', a.logo, 'logo_lockup', a.logo_lockup,
    'voucher_note', a.voucher_note);
end $function$;

-- Expose logo_lockup on the public (QR) agent-branded voucher.
CREATE OR REPLACE FUNCTION public.public_transport_voucher(p_token uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select case when b.id is null then null else jsonb_build_object(
    'booking', jsonb_build_object(
      'booking_no', b.booking_no, 'booking_date', b.booking_date,
      'passenger_name', b.passenger_name, 'mobile', b.mobile, 'whatsapp', b.whatsapp,
      'pax', b.pax, 'nationality', b.nationality, 'status', b.status, 'booking_type', b.booking_type,
      'arrival_flight', b.arrival_flight, 'arrival_date', b.arrival_date, 'arrival_time', b.arrival_time,
      'departure_flight', b.departure_flight, 'departure_date', b.departure_date, 'departure_time', b.departure_time,
      'total_amount', b.total_amount, 'currency', b.currency, 'remarks', b.remarks),
    'agent', (select jsonb_build_object('agency_name', a.agency_name, 'contact_person', a.contact_person,
       'email', a.email, 'mobile', a.mobile, 'address', a.address, 'logo', a.logo,
       'logo_lockup', a.logo_lockup, 'voucher_note', a.voucher_note)
       from b2b_agents a where a.agent_party_id = b.agent_id or a.id = b.agent_id limit 1),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seq', t.seq, 'route', coalesce(r.name, t.route_label), 'trip_date', t.trip_date,
        'trip_time', t.trip_time, 'pickup_location', t.pickup_location, 'drop_location', t.drop_location,
        'vehicle', v.name, 'hajj_terminal', t.hajj_terminal,
        'fare', coalesce(t.sell_rate, 0) + coalesce(t.extra_charge, 0)) order by t.seq)
      from transport_trips t
      left join transport_routes r on r.id = t.route_id
      left join transport_vehicles v on v.id = coalesce(t.requested_vehicle_id, t.vehicle_id)
      where t.booking_id = b.id), '[]'::jsonb)
  ) end
  from transport_bookings b where b.public_token = p_token;
$function$;
