-- A notification you cannot open is a notification that only tells you off.
--
-- Clicking one worked for "New Visa Group" and nothing else, and the reason is
-- in the bell: it navigates to `link` if there is one, else to
-- `/groups/<group_id>`, and shows the Open button only when one of the two
-- exists. Of the sixteen senders, exactly two set a link — gl_submit and
-- acct_hold_document, both to /accounting/approvals. Everything else left it
-- null, so:
--
--   * Tafweej required, the three HCN escalations, Drivers assigned, New hotel
--     booking request, Voucher rejected — no link AND no id, so no Open button
--     at all. Nothing to click, which is what was reported.
--
--   * the transport ones were WORSE THAN NOTHING. They pass a transport BOOKING
--     id in the group_id argument, so the bell sent you to /groups/<booking id>
--     — a visa-group route holding a booking's id. Not a dead click: a wrong
--     one, landing on a group that does not exist.
--
-- FIXED IN ONE PLACE, NOT SIXTEEN. push_notification is the single door every
-- notification goes through, and it already receives the audience, the category
-- and that id. So the link is resolved THERE when a sender does not give one.
-- Rewriting ten senders to each hard-code a route would have been ten chances
-- to get it wrong, and the next sender added would have been the eleventh.
--
-- WHAT MAKES IT EXACT RATHER THAN A GUESS. The id is looked up in the three
-- tables it could belong to — umrah_groups, transport_bookings, hotel_bookings
-- — and the route follows from which one actually owns it. That is how the
-- transport bookings stop being sent to /groups: nothing infers, it checks.
-- Only when there is no id at all does it fall back to the category's list
-- screen, which is a weaker answer but an honest one, and still better than a
-- button that is not there.
--
-- Agents get agent routes. The portal is a different application with its own
-- paths, and sending an agent to /transport/bookings/... would put them at a
-- staff URL they cannot open.

begin;

-- ── where does this notification point? ────────────────────────────────────
create or replace function public.notification_link(
  p_audience text, p_category text, p_module text, p_ref uuid)
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $f$
declare v_agent boolean := coalesce(p_audience, 'staff') = 'agent';
begin
  -- The id first, because it is the only thing that can name a record. Checked
  -- against each table rather than inferred from the module: a transport
  -- notification carrying a booking id and a visa notification carrying a group
  -- id arrive through the same argument.
  if p_ref is not null then
    if exists (select 1 from umrah_groups where id = p_ref) then
      return case when v_agent then '/agent/groups/' else '/groups/' end || p_ref;
    end if;
    if exists (select 1 from transport_bookings where id = p_ref) then
      return case when v_agent then '/agent/module/transport/' else '/transport/bookings/' end || p_ref;
    end if;
    if exists (select 1 from hotel_bookings where id = p_ref) then
      return case when v_agent then '/agent/module/hotels/' else '/hotels/bookings/' end || p_ref;
    end if;
  end if;

  -- No id: the list the notification is about. Weaker, but it opens.
  return case lower(coalesce(p_category, ''))
    when 'accounting' then '/accounting/approvals'
    when 'transport'  then case when v_agent then '/agent/module/transport/schedule' else '/transport/bookings' end
    when 'hotel'      then case when v_agent then '/agent/module/hotels' else '/hotels/bookings' end
    when 'brn'        then case when v_agent then '/agent/groups' else '/groups' end
    when 'package'    then case when v_agent then '/agent/groups' else '/groups' end
    when 'visa'       then case when v_agent then '/agent/groups' else '/groups' end
    else case when v_agent then '/agent' else '/dashboard' end
  end;
end $f$;
revoke all on function public.notification_link(text, text, text, uuid) from public, anon;
grant execute on function public.notification_link(text, text, text, uuid) to authenticated;

-- ── the one door, now always leaving a way back ────────────────────────────
-- The eight-argument form is the real one. It fills in the link when the caller
-- passes none — voucher_approve passes an explicit null, so "was a link given"
-- has to mean "is it null", not "which overload was called".
create or replace function public.push_notification(
  p_audience text, p_agent_id uuid, p_category text, p_title text, p_body text,
  p_module text, p_group_id uuid, p_link text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into notifications (audience, agent_id, category, title, body, module, group_id, link)
  values (p_audience, p_agent_id, p_category, p_title, p_body, p_module, p_group_id,
          coalesce(nullif(btrim(coalesce(p_link, '')), ''),
                   notification_link(p_audience, p_category, p_module, p_group_id)));
$function$;

-- The seven-argument form is what most senders still call. It delegates rather
-- than repeating the insert, so there is one statement writing notifications.
create or replace function public.push_notification(
  p_audience text, p_agent_id uuid, p_category text, p_title text, p_body text,
  p_module text, p_group_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  select push_notification(p_audience, p_agent_id, p_category, p_title, p_body,
                           p_module, p_group_id, null::text);
$function$;

-- ── two senders that can be precise, and were not ──────────────────────────
-- Both know exactly which booking they are complaining about and were throwing
-- it away. With the id passed, the resolver returns the booking's own screen
-- rather than the list.
create or replace function public.generate_hotel_hcn_reminders(p_secret text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_hours numeric; v_threshold int; v_title text; v_body text; n int := 0;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  for r in
    select p.id as purchase_id, p.company_id, b.id as booking_id, b.booking_no, b.guest_name,
           coalesce(b.hotel_name, h.name) as hotel_name, b.check_in
    from hotel_purchase_bookings p
    join hotel_bookings b on b.id = p.booking_id
    left join hotels h on h.id = b.hotel_id
    where b.status not in ('completed','cancelled')
      and coalesce(p.hcn_status,'pending') = 'pending'
      and b.check_in is not null
      and b.check_in >= current_date
      and b.check_in <= current_date + 2
  loop
    v_hours := extract(epoch from ((r.check_in::timestamp) - now())) / 3600;
    if r.check_in = current_date then v_threshold := 0;
    elsif v_hours <= 24 then v_threshold := 24;
    else v_threshold := 48; end if;

    if exists (select 1 from hotel_hcn_reminder_sent s where s.purchase_id = r.purchase_id and s.threshold = v_threshold) then
      continue;
    end if;

    if v_threshold = 0 then
      v_title := 'Critical: Guest Check-in Today – HCN Missing';
    elsif v_threshold = 24 then
      v_title := 'Urgent: HCN Not Received';
    else
      v_title := 'HCN Pending – Action Required';
    end if;
    v_body := r.booking_no || ' · ' || coalesce(r.guest_name,'') || ' · ' || coalesce(r.hotel_name,'hotel')
              || ' · check-in ' || to_char(r.check_in,'DD Mon');

    -- the booking id, so the reminder opens the booking that is missing its HCN
    perform push_notification('staff', null, 'hotel', v_title, v_body, 'hotels', r.booking_id);
    insert into hotel_hcn_reminder_sent(purchase_id, threshold) values (r.purchase_id, v_threshold)
      on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $function$;

create or replace function public.generate_tafweej_reminders(p_secret text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; hrs numeric; n int := 0;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  for r in
    select t.id, t.company_id, t.trip_date, t.trip_time, t.flight_no, t.booking_id,
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
      -- the booking id, so "create Tafweej" opens the booking it is needed on
      perform push_notification('staff', null, 'transport',
        'Tafweej required · ' || coalesce(r.passenger_name, r.booking_no, 'arrival'),
        'Create Tafweej for the Jeddah-airport Umrah arrival ' ||
          coalesce(r.passenger_name,'') || ' (' || coalesce(r.flight_no,'flight') || ') at ' ||
          to_char(r.trip_time,'HH24:MI') || ' on ' || to_char(r.trip_date,'DD Mon') ||
          ' — ~' || round(hrs) || 'h left.',
        'transport', r.booking_id);
      insert into tafweej_reminder_sent(trip_id) values (r.id) on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$;

-- ── the notifications already sitting in the bell ──────────────────────────
-- Backfilled, because the fix above only helps what is sent from now on and
-- these are the ones the user is looking at today. Same resolver, so an old
-- notification and a new one of the same kind open the same screen.
update public.notifications
   set link = notification_link(audience, category, module, group_id)
 where coalesce(btrim(coalesce(link, '')), '') = '';

do $chk$
declare v_n int;
begin
  select count(*) into v_n from notifications
   where coalesce(btrim(coalesce(link,'')),'') = '';
  if v_n <> 0 then raise exception '353: % notification(s) still have no link', v_n; end if;

  -- a transport booking id must NOT resolve to a visa-group route
  if exists (select 1 from notifications where category = 'transport' and link like '/groups/%')
  then raise exception '353: a transport notification still points at /groups'; end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='push_notification') <> 2
  then raise exception '353: expected exactly the two push_notification forms'; end if;
end $chk$;

commit;
