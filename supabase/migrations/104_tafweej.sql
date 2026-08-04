-- ============================================================
-- VISTA ERP - 104 Tafweej tracking for Jeddah-airport Umrah arrivals
-- Dispatchers tick 'Tafweej Created' on qualifying trips (arrival picked up AT
-- Jeddah airport + Umrah visa). generate_tafweej_reminders() (run from the
-- reminders cron) notifies staff ~6h before arrival for any such trip not yet
-- created, deduped via tafweej_reminder_sent.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================
alter table transport_trips add column if not exists tafweej_created boolean not null default false;

create table if not exists tafweej_reminder_sent (
  trip_id uuid primary key references transport_trips(id) on delete cascade,
  sent_at timestamptz not null default now()
);

create or replace function public.transport_set_tafweej(p_trip uuid, p_val boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update transport_trips set tafweej_created = coalesce(p_val, false)
  where id = p_trip and company_id = auth_company_id();
  if not found then raise exception 'Trip not found'; end if;
end $function$;

create or replace function public.is_jeddah_umrah_arrival(p_route uuid, p_visa text)
returns boolean language sql stable set search_path to 'public' as $function$
  select coalesce(p_visa,'') = 'umrah' and exists (
    select 1 from transport_routes r where r.id = p_route
      and ( (r.from_location ilike '%jeddah%' and r.from_location ilike '%airport%')
            or r.name ilike 'jeddah airport%' )
  );
$function$;

create or replace function public.generate_tafweej_reminders()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; hrs numeric; n int := 0;
begin
  for r in
    select t.id, t.company_id, t.trip_date, t.trip_time, t.flight_no,
           b.passenger_name, b.booking_no
    from transport_trips t
    join transport_bookings b on b.id = t.booking_id
    where coalesce(t.tafweej_created,false) = false
      and t.status not in ('cancelled','completed')
      and t.trip_time is not null
      and t.trip_date >= current_date
      and is_jeddah_umrah_arrival(t.route_id, t.passenger_visa_type)
      and not exists (select 1 from tafweej_reminder_sent s where s.trip_id = t.id)
  loop
    hrs := extract(epoch from ((r.trip_date + r.trip_time)::timestamp - now())) / 3600.0;
    if hrs > 0 and hrs <= 6 then
      perform push_notification('staff', null, 'transport',
        'Tafweej required · ' || coalesce(r.passenger_name, r.booking_no, 'arrival'),
        'Create Tafweej for the Jeddah-airport Umrah arrival ' ||
          coalesce(r.passenger_name,'') || ' (' || coalesce(r.flight_no,'flight') || ') at ' ||
          to_char(r.trip_time,'HH24:MI') || ' on ' || to_char(r.trip_date,'DD Mon') ||
          ' — ~' || round(hrs) || 'h left.',
        'transport', null);
      insert into tafweej_reminder_sent(trip_id) values (r.id) on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$;
revoke all on function public.transport_set_tafweej(uuid, boolean) from anon, public;
