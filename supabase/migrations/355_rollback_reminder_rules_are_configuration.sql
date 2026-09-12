-- Undo 355. The three reminder jobs go back to carrying their hours and their
-- wording inside their own bodies, and the screen that edited them stops
-- working. Restores 354's HCN behaviour (24/12/4 from 14:00) and the
-- hotel/tafweej jobs as they were before — including the hotel-details job
-- firing EVERY threshold it has not sent rather than only the tightest.
--
-- Any wording or hours an admin changed are lost with the table.

begin;

drop function if exists public.notification_rules_save(text, boolean, int[], text, text, jsonb, text);
drop function if exists public.notification_rules_list();

create or replace function public.generate_hotel_reminders(p_secret text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; th int; hrs numeric; n int := 0;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  for r in
    select g.id, g.group_no, g.arrival_date, a.id as b2b_id, a.agency_name
    from umrah_groups g
    left join b2b_agents a on a.agent_party_id = g.agent_id
    where coalesce(g.visa_type,'normal') in ('normal','masar')
      and coalesce(g.workflow_status,'pending') <> 'rejected'
      and coalesce(g.visa_status,'pending') <> 'issued'
      and g.arrival_date >= current_date
      and (g.hotel_details is null or jsonb_array_length(coalesce(g.hotel_details, '[]'::jsonb)) = 0)
  loop
    hrs := extract(epoch from ((r.arrival_date::timestamp) - now())) / 3600.0;
    if hrs <= 0 then continue; end if;
    foreach th in array array[48,24,12] loop
      if hrs <= th and not exists (select 1 from hotel_reminder_sent where group_id = r.id and audience = 'agent' and threshold = th) then
        if r.b2b_id is not null then
          perform push_notification('agent', r.b2b_id, 'package',
            'Hotel details required · ' || r.group_no,
            'Please add Hotel Details for group ' || r.group_no || ' before arrival on ' || to_char(r.arrival_date, 'DD Mon') || ' (~' || round(hrs) || 'h left).',
            'hotel', r.id);
        end if;
        insert into hotel_reminder_sent(group_id, audience, threshold) values (r.id, 'agent', th) on conflict do nothing;
        n := n + 1;
      end if;
    end loop;
    if hrs <= 24 and not exists (select 1 from hotel_reminder_sent where group_id = r.id and audience = 'staff' and threshold = 24) then
      perform push_notification('staff', null, 'package',
        'Hotel details missing · ' || r.group_no,
        'Agent ' || coalesce(r.agency_name, '—') || ' has not added Hotel Details. Arrival ' || to_char(r.arrival_date, 'DD Mon') || ' (~' || round(hrs) || 'h left).',
        'hotel', r.id);
      insert into hotel_reminder_sent(group_id, audience, threshold) values (r.id, 'staff', 24) on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$;

create or replace function public.generate_hotel_hcn_reminders(p_secret text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare HCN_CHECKIN_TIME constant time := time '14:00';
  r record; v_left numeric; v_threshold int; v_title text; v_body text; v_due timestamp; n int := 0;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  for r in
    select p.id as purchase_id, b.id as booking_id, b.booking_no, b.guest_name,
           coalesce(b.hotel_name, h.name) as hotel_name, b.check_in
    from hotel_purchase_bookings p
    join hotel_bookings b on b.id = p.booking_id
    left join hotels h on h.id = b.hotel_id
    where b.status not in ('completed','cancelled')
      and coalesce(p.hcn_status,'pending') = 'pending'
      and b.check_in is not null and b.check_in >= current_date and b.check_in <= current_date + 1
  loop
    v_due := r.check_in + HCN_CHECKIN_TIME;
    v_left := extract(epoch from (v_due - localtimestamp)) / 3600.0;
    if    v_left <= 4  then v_threshold := 4;
    elsif v_left <= 12 then v_threshold := 12;
    elsif v_left <= 24 then v_threshold := 24;
    else  continue; end if;
    if exists (select 1 from hotel_hcn_reminder_sent s where s.purchase_id = r.purchase_id and s.threshold = v_threshold) then continue; end if;
    v_title := case v_threshold when 24 then 'HCN Pending – Action Required'
                                when 12 then 'Urgent: HCN Not Received'
                                else 'Critical: Guest Check-in Today – HCN Missing' end;
    v_body := r.booking_no || ' · ' || coalesce(r.guest_name,'') || ' · ' || coalesce(r.hotel_name,'hotel')
              || ' · check-in ' || to_char(v_due, 'DD Mon HH24:MI')
              || case when v_left >= 0 then ' · ~' || round(v_left) || 'h left' else ' · check-in time has passed' end;
    perform push_notification('staff', null, 'hotel', v_title, v_body, 'hotels', r.booking_id);
    insert into hotel_hcn_reminder_sent(purchase_id, threshold) values (r.purchase_id, v_threshold) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $function$;

create or replace function public.generate_tafweej_reminders(p_secret text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; hrs numeric; n int := 0;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  for r in
    select t.id, t.trip_date, t.trip_time, t.flight_no, t.booking_id, b.passenger_name, b.booking_no
    from transport_trips t join transport_bookings b on b.id = t.booking_id
    where coalesce(t.tafweej_created,false) = false
      and t.status not in ('cancelled','completed') and t.trip_time is not null
      and t.trip_date >= current_date
      and is_jeddah_umrah_arrival(t.route_id, t.passenger_visa_type)
      and not exists (select 1 from tafweej_reminder_sent s where s.trip_id = t.id)
  loop
    hrs := extract(epoch from ((r.trip_date + r.trip_time)::timestamp - now())) / 3600.0;
    if hrs > 0 and hrs <= 6 then
      perform push_notification('staff', null, 'transport',
        'Tafweej required · ' || coalesce(r.passenger_name, r.booking_no, 'arrival'),
        'Create Tafweej for the Jeddah-airport Umrah arrival ' || coalesce(r.passenger_name,'') ||
          ' (' || coalesce(r.flight_no,'flight') || ') at ' || to_char(r.trip_time,'HH24:MI') ||
          ' on ' || to_char(r.trip_date,'DD Mon') || ' — ~' || round(hrs) || 'h left.',
        'transport', r.booking_id);
      insert into tafweej_reminder_sent(trip_id) values (r.id) on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$;

drop function if exists public.notif_rule_title(notification_rules, int);
drop function if exists public.notif_render(text, jsonb);
drop table if exists public.notification_rules;

commit;
