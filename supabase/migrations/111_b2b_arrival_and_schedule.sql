-- ============================================================
-- VISTA ERP - 111 B2B arrival compliance, arrival-service choice, transport schedule
-- Agent-scoped (token) versions of the arrival-service compliance feed and the
-- declared-choice setter, plus b2b_transport_schedule feeding the read-only agent
-- Transport Schedule. (Applied via Supabase MCP; kept for history.)
-- ============================================================
create or replace function public.b2b_set_arrival_service(p_token text, p_group uuid, p_option text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  if p_option is not null and p_option not in ('transport','tafweej') then raise exception 'Invalid option'; end if;
  update umrah_groups set arrival_service = p_option
  where id = p_group and company_id = a.company_id and agent_id = coalesce(a.agent_party_id, a.id);
  if not found then raise exception 'Group not found'; end if;
end $$;

create or replace function public.b2b_arrival_compliance(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a b2b_agents%rowtype; v jsonb;
begin
  a := b2b_agent_of(p_token);
  select coalesce(jsonb_agg(x order by x->>'arrival_date'), '[]'::jsonb) into v from (
    select jsonb_build_object('id', g.id, 'group_no', g.group_no, 'arrival_date', g.arrival_date,
      'pax', g.pax, 'arrival_service', g.arrival_service,
      'days_to_arrival', (g.arrival_date - current_date)) as x
    from umrah_groups g
    where g.company_id = a.company_id and g.agent_id = coalesce(a.agent_party_id, a.id)
      and coalesce(g.workflow_status,'pending') <> 'rejected'
      and g.arrival_date is not null and g.arrival_date >= current_date
      and g.arrival_date <= current_date + 30
      and arrival_service_state(g.id) = 'pending'
  ) q;
  return v;
end $$;

create or replace function public.b2b_transport_schedule(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a b2b_agents%rowtype; v jsonb;
begin
  a := b2b_agent_of(p_token);
  select coalesce(jsonb_agg(x order by x->>'trip_date', x->>'trip_time'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'trip_id', ts.id, 'booking_id', ts.booking_id, 'booking_no', b.booking_no,
      'passenger_name', b.passenger_name, 'group_no', b.nusuk_group_no,
      'route', coalesce(ts.route_name, ts.route_label), 'trip_date', ts.trip_date,
      'trip_time', to_char(ts.trip_time,'HH24:MI'), 'status', ts.status,
      'vehicle', veh.name, 'flight_no', ts.flight_no,
      'driver_name', coalesce(dr.name, t.outsource_driver_name),
      'driver_mobile', coalesce(dr.mobile, t.outsource_driver_mobile),
      'is_arrival', (coalesce(ts.route_name,'') ilike '%airport -%' or coalesce(ts.pickup_location,'') ilike '%airport%'),
      'is_departure', (coalesce(ts.route_name,'') ilike '%- % airport%' or coalesce(ts.drop_location,'') ilike '%airport%')
    ) as x
    from transport_trip_sched ts
    join transport_bookings b on b.id = ts.booking_id
    left join transport_trips t on t.id = ts.id
    left join transport_drivers dr on dr.id = ts.driver_id
    left join transport_vehicles veh on veh.id = coalesce(ts.vehicle_id, ts.requested_vehicle_id)
    where b.company_id = a.company_id and b.agent_id = coalesce(a.agent_party_id, a.id)
      and b.status <> 'cancelled' and ts.trip_date >= current_date - 1
  ) q;
  return v;
end $$;
