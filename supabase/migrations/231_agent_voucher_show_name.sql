-- 231_agent_voucher_show_name.sql
-- B2B agent voucher branding: a per-agent toggle for whether the agency NAME is
-- printed on their voucher. When on (default), the agent voucher shows the logo
-- AND the agency name. When off, it shows ONLY the logo (for agents whose logo
-- already contains their name).
alter table b2b_agents add column if not exists voucher_show_name boolean not null default true;

-- Expose it on the public transport voucher so the login-free (QR) voucher honours
-- the same choice.
create or replace function public_transport_voucher(p_token uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
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
       'logo_lockup', a.logo_lockup, 'voucher_note', a.voucher_note, 'voucher_show_name', a.voucher_show_name)
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
      where t.booking_id = b.id and coalesce(t.status,'') <> 'cancelled'), '[]'::jsonb)
  ) end
  from transport_bookings b where b.public_token = p_token;
$function$;
