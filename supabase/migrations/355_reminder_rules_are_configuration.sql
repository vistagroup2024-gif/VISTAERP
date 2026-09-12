-- When a reminder fires, and what it says, becomes a row you can edit.
--
-- The HCN timings were wrong for months and it took a migration to change them.
-- The hours, the wording and whether the reminder runs at all were buried in
-- plpgsql — so "send it 4 hours before, not on the day" was a code change, and
-- the person who knew the business had to ask somebody who knew the database.
--
-- Three jobs are affected, and they are the three that have a SCHEDULE:
--
--   hotel.details_agent   48h / 24h / 12h before arrival, to the agent
--   hotel.details_staff   24h before arrival, to staff
--   hotel.hcn             24h / 12h / 4h before check-in (14:00), to staff
--   transport.tafweej     6h before the trip, to staff
--
-- WHAT IS NOT HERE, AND WHY. The event-driven notifications — Drivers assigned,
-- Voucher awaiting authorisation, Cancellation requested, and the rest — have no
-- schedule to edit. Their text could be made editable too, but that means
-- threading a rule key through thirteen more routines, several of them large,
-- and the gain is the wording of a sentence rather than the hour a warning
-- arrives. They are left alone rather than half-done: a screen listing them with
-- everything greyed out would be worse than a screen that does not claim them.
--
-- A PLACEHOLDER THAT DOES NOT EXIST IS REFUSED ON SAVE. Every rule declares
-- which tokens its body may use, and the save checks the text against that list.
-- Without it a typo like {guest_name} where the rule offers {guest} would save
-- happily and then appear literally, in braces, in a notification sent to a
-- customer-facing agent — the failure would be invisible until somebody read
-- one.
--
-- THE TIGHTEST THRESHOLD WINS, for all of them now. It already did for HCN. The
-- hotel-details job used to fire EVERY threshold it had not yet sent, so after
-- an outage a booking 10 hours out received "48h left", "24h left" and "12h
-- left" together — three notifications, two of them false about the clock. Under
-- hourly running the two rules behave identically; they differ only when the job
-- has missed runs, and that is exactly when the tightest one is the only honest
-- answer.

begin;

create table if not exists public.notification_rules (
  rule_key     text primary key,
  label        text not null,
  module       text not null,
  category     text not null,
  audience     text not null check (audience in ('staff','agent')),
  enabled      boolean not null default true,
  -- Hours before the anchor, one notification per entry. Descending by
  -- convention; the job takes the tightest one reached either way.
  thresholds   int[] not null default '{}',
  anchor_label text not null,
  -- The time of day the anchor date means. 14:00 for a hotel check-in; null
  -- where the anchor is the date itself.
  anchor_time  time,
  title        text not null,
  -- Optional per-threshold titles, keyed by the hour: {"24": "...", "4": "..."}.
  -- The HCN escalation needs three different titles for three distances; the
  -- others say the same thing each time and use `title` alone.
  titles       jsonb not null default '{}'::jsonb,
  body         text not null,
  placeholders text[] not null default '{}',
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null
);

alter table public.notification_rules enable row level security;

drop policy if exists notification_rules_staff on public.notification_rules;
create policy notification_rules_staff on public.notification_rules
  for select using ((select is_staff()));

grant select on public.notification_rules to authenticated;

insert into public.notification_rules
  (rule_key, label, module, category, audience, thresholds, anchor_label, anchor_time,
   title, titles, body, placeholders) values

  ('hotel.details_agent', 'Hotel details required (to the agent)', 'hotel', 'package', 'agent',
   array[48,24,12], 'group arrival date', null,
   'Hotel details required · {group_no}',
   '{}'::jsonb,
   'Please add Hotel Details for group {group_no} before arrival on {arrival} (~{hours}h left).',
   array['group_no','arrival','hours','agency']),

  ('hotel.details_staff', 'Hotel details missing (to staff)', 'hotel', 'package', 'staff',
   array[24], 'group arrival date', null,
   'Hotel details missing · {group_no}',
   '{}'::jsonb,
   'Agent {agency} has not added Hotel Details. Arrival {arrival} (~{hours}h left).',
   array['group_no','arrival','hours','agency']),

  ('hotel.hcn', 'HCN not received (to staff)', 'hotels', 'hotel', 'staff',
   array[24,12,4], 'hotel check-in', time '14:00',
   'HCN Pending – Action Required',
   jsonb_build_object('24','HCN Pending – Action Required',
                      '12','Urgent: HCN Not Received',
                      '4','Critical: Guest Check-in Today – HCN Missing'),
   '{booking_no} · {guest} · {hotel} · check-in {check_in} · ~{hours}h left',
   array['booking_no','guest','hotel','check_in','hours']),

  ('transport.tafweej', 'Tafweej required (to staff)', 'transport', 'transport', 'staff',
   array[6], 'trip date and time', null,
   'Tafweej required · {passenger}',
   '{}'::jsonb,
   'Create Tafweej for the Jeddah-airport Umrah arrival {passenger} ({flight}) at {time} on {date} — ~{hours}h left.',
   array['passenger','flight','time','date','hours','booking_no'])

on conflict (rule_key) do nothing;

-- ── rendering ──────────────────────────────────────────────────────────────
-- {token} substitution, nothing cleverer. A token the caller did not supply is
-- replaced with an empty string rather than left in braces: a half-rendered
-- template reaching an agent reads as a broken system, and the save below is
-- what stops unknown tokens getting in at all.
create or replace function public.notif_render(p_template text, p_vars jsonb)
returns text
language plpgsql
immutable
as $f$
declare k text; v text; out_text text := coalesce(p_template, '');
begin
  for k, v in select key, coalesce(value, '') from jsonb_each_text(coalesce(p_vars, '{}'::jsonb))
  loop
    out_text := replace(out_text, '{' || k || '}', v);
  end loop;
  -- anything still in braces was not supplied
  return btrim(regexp_replace(out_text, '\{[a-z_]+\}', '', 'g'));
end $f$;

-- The title for a given distance: the per-threshold override if there is one,
-- otherwise the rule's single title.
create or replace function public.notif_rule_title(p_rule notification_rules, p_threshold int)
returns text
language sql
immutable
as $f$
  select coalesce(nullif(p_rule.titles->>(p_threshold::text), ''), p_rule.title);
$f$;

-- ── reading and writing the rules ──────────────────────────────────────────
create or replace function public.notification_rules_list()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rule_key', r.rule_key, 'label', r.label, 'module', r.module, 'category', r.category,
    'audience', r.audience, 'enabled', r.enabled, 'thresholds', r.thresholds,
    'anchor_label', r.anchor_label,
    'anchor_time', case when r.anchor_time is null then null else to_char(r.anchor_time, 'HH24:MI') end,
    'title', r.title, 'titles', r.titles, 'body', r.body, 'placeholders', r.placeholders,
    'updated_at', r.updated_at,
    'updated_by_name', (select full_name from profiles p where p.id = r.updated_by)
  ) order by r.module, r.rule_key), '[]'::jsonb)
  from notification_rules r where is_staff();
$f$;
revoke all on function public.notification_rules_list() from public, anon;
grant execute on function public.notification_rules_list() to authenticated;

create or replace function public.notification_rules_save(
  p_key text, p_enabled boolean, p_thresholds int[], p_anchor_time text,
  p_title text, p_titles jsonb, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare r notification_rules; v_th int[]; v_bad text; v_time time; t text;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  -- Changing these changes what everybody in the company is told and when, so
  -- it is not an ordinary screen right: strict, so a blank profile does not
  -- hold it.
  if not (has_role('admin') or staff_perm_strict('notifications.manage')) then
    raise exception 'You do not have permission to change notification rules';
  end if;

  select * into r from notification_rules where rule_key = p_key;
  if not found then raise exception 'Unknown notification rule'; end if;

  if coalesce(btrim(p_title), '') = '' then raise exception 'The title cannot be empty'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'The message cannot be empty'; end if;

  -- Positive, whole, distinct, and sorted widest-first. A zero or negative hour
  -- would mean "after it has happened", which the jobs express by still firing
  -- their tightest threshold rather than by a threshold of their own.
  select coalesce(array_agg(distinct h order by h desc), '{}') into v_th
    from unnest(coalesce(p_thresholds, '{}'::int[])) h where h > 0;
  if array_length(v_th, 1) is null then
    raise exception 'Give at least one reminder time, in hours before the %', r.anchor_label;
  end if;
  if array_length(v_th, 1) > 6 then
    raise exception 'Six reminder times is the most this can carry';
  end if;
  if (select max(h) from unnest(v_th) h) > 720 then
    raise exception 'A reminder more than 30 days ahead is not a reminder';
  end if;

  -- THE PLACEHOLDER CHECK. A token the rule does not offer would render as
  -- nothing and the sentence would read wrong, with no error anywhere.
  for t in select m[1] from regexp_matches(coalesce(p_title,'') || ' ' || coalesce(p_body,''),
                                           '\{([a-z_]+)\}', 'g') m
  loop
    if not (t = any (r.placeholders)) then
      v_bad := coalesce(v_bad || ', ', '') || '{' || t || '}';
    end if;
  end loop;
  if v_bad is not null then
    raise exception 'Unknown placeholder %. This rule offers: %',
      v_bad, '{' || array_to_string(r.placeholders, '} {') || '}';
  end if;

  if coalesce(btrim(coalesce(p_anchor_time,'')), '') = '' then v_time := null;
  else v_time := p_anchor_time::time; end if;

  update notification_rules
     set enabled = coalesce(p_enabled, enabled),
         thresholds = v_th,
         anchor_time = v_time,
         title = btrim(p_title),
         titles = coalesce(p_titles, '{}'::jsonb),
         body = btrim(p_body),
         updated_at = now(), updated_by = auth.uid()
   where rule_key = p_key
   returning * into r;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (auth_company_id(), auth.uid(), 'notification_rule_changed', 'notification_rule', null,
          jsonb_build_object('rule', p_key, 'enabled', r.enabled, 'thresholds', r.thresholds,
                             'anchor_time', r.anchor_time, 'title', r.title, 'body', r.body));

  return jsonb_build_object('ok', true, 'rule_key', r.rule_key, 'thresholds', r.thresholds);
end $f$;
revoke all on function public.notification_rules_save(text, boolean, int[], text, text, jsonb, text) from public, anon;
grant execute on function public.notification_rules_save(text, boolean, int[], text, text, jsonb, text) to authenticated;

-- ── the three jobs now read their rule ─────────────────────────────────────
create or replace function public.generate_hotel_reminders(p_secret text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare ra notification_rules; rs notification_rules; r record;
        hrs numeric; th int; v_th int; n int := 0; v_vars jsonb;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  select * into ra from notification_rules where rule_key = 'hotel.details_agent';
  select * into rs from notification_rules where rule_key = 'hotel.details_staff';

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
    hrs := extract(epoch from ((r.arrival_date + coalesce(ra.anchor_time, time '00:00')) - localtimestamp)) / 3600.0;

    v_vars := jsonb_build_object(
      'group_no', r.group_no,
      'arrival', to_char(r.arrival_date, 'DD Mon'),
      'hours', round(greatest(hrs, 0))::text,
      'agency', coalesce(r.agency_name, '—'));

    -- AGENT: the tightest threshold reached, so a late run says where we are
    -- rather than sending 48h, 24h and 12h together.
    if ra.enabled and r.b2b_id is not null then
      v_th := null;
      for th in select h from unnest(ra.thresholds) h order by h asc loop
        if hrs <= th then v_th := th; exit; end if;
      end loop;
      if v_th is not null and not exists (
          select 1 from hotel_reminder_sent
           where group_id = r.id and audience = 'agent' and threshold = v_th) then
        perform push_notification('agent', r.b2b_id, ra.category,
          notif_render(notif_rule_title(ra, v_th), v_vars),
          notif_render(ra.body, v_vars), ra.module, r.id);
        insert into hotel_reminder_sent(group_id, audience, threshold) values (r.id, 'agent', v_th)
          on conflict do nothing;
        n := n + 1;
      end if;
    end if;

    -- STAFF
    if rs.enabled then
      v_th := null;
      for th in select h from unnest(rs.thresholds) h order by h asc loop
        if hrs <= th then v_th := th; exit; end if;
      end loop;
      if v_th is not null and not exists (
          select 1 from hotel_reminder_sent
           where group_id = r.id and audience = 'staff' and threshold = v_th) then
        perform push_notification('staff', null, rs.category,
          notif_render(notif_rule_title(rs, v_th), v_vars),
          notif_render(rs.body, v_vars), rs.module, r.id);
        insert into hotel_reminder_sent(group_id, audience, threshold) values (r.id, 'staff', v_th)
          on conflict do nothing;
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $function$;

create or replace function public.generate_hotel_hcn_reminders(p_secret text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rr notification_rules; r record; v_left numeric; th int; v_th int;
        v_due timestamp; n int := 0; v_vars jsonb; v_widest int;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  select * into rr from notification_rules where rule_key = 'hotel.hcn';
  if not rr.enabled then return 0; end if;
  select max(h) into v_widest from unnest(rr.thresholds) h;

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
      -- wide enough for the widest configured reminder, so raising it to 72h
      -- does not silently keep firing at 24
      and b.check_in <= current_date + (ceil(coalesce(v_widest, 24) / 24.0) + 1)::int
  loop
    v_due  := r.check_in + coalesce(rr.anchor_time, time '00:00');
    v_left := extract(epoch from (v_due - localtimestamp)) / 3600.0;

    v_th := null;
    for th in select h from unnest(rr.thresholds) h order by h asc loop
      if v_left <= th then v_th := th; exit; end if;
    end loop;
    if v_th is null then continue; end if;

    if exists (select 1 from hotel_hcn_reminder_sent s
                where s.purchase_id = r.purchase_id and s.threshold = v_th) then
      continue;
    end if;

    v_vars := jsonb_build_object(
      'booking_no', coalesce(r.booking_no,''),
      'guest', coalesce(r.guest_name,''),
      'hotel', coalesce(r.hotel_name,'hotel'),
      'check_in', to_char(v_due, 'DD Mon HH24:MI'),
      'hours', case when v_left >= 0 then round(v_left)::text else '0' end);

    perform push_notification('staff', null, rr.category,
      notif_render(notif_rule_title(rr, v_th), v_vars),
      notif_render(rr.body, v_vars), rr.module, r.booking_id);
    insert into hotel_hcn_reminder_sent(purchase_id, threshold) values (r.purchase_id, v_th)
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
declare rr notification_rules; r record; hrs numeric; th int; v_th int;
        n int := 0; v_vars jsonb;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  select * into rr from notification_rules where rule_key = 'transport.tafweej';
  if not rr.enabled then return 0; end if;

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
    hrs := extract(epoch from ((r.trip_date + r.trip_time)::timestamp - localtimestamp)) / 3600.0;
    if hrs <= 0 then continue; end if;   -- the trip has gone; Tafweej is moot

    v_th := null;
    for th in select h from unnest(rr.thresholds) h order by h asc loop
      if hrs <= th then v_th := th; exit; end if;
    end loop;
    if v_th is null then continue; end if;

    v_vars := jsonb_build_object(
      'passenger', coalesce(r.passenger_name, r.booking_no, 'arrival'),
      'booking_no', coalesce(r.booking_no,''),
      'flight', coalesce(r.flight_no,'flight'),
      'time', to_char(r.trip_time,'HH24:MI'),
      'date', to_char(r.trip_date,'DD Mon'),
      'hours', round(hrs)::text);

    perform push_notification('staff', null, rr.category,
      notif_render(notif_rule_title(rr, v_th), v_vars),
      notif_render(rr.body, v_vars), rr.module, r.booking_id);
    insert into tafweej_reminder_sent(trip_id) values (r.id) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $function$;

do $chk$
declare v_n int; v_t text;
begin
  select count(*) into v_n from notification_rules;
  if v_n <> 4 then raise exception '355: expected 4 reminder rules, found %', v_n; end if;

  -- the HCN rule must still describe what 354 established
  select array_to_string(thresholds, ',') into v_t from notification_rules where rule_key = 'hotel.hcn';
  if v_t <> '24,12,4' then raise exception '355: the HCN thresholds are %, not 24,12,4', v_t; end if;
  if (select anchor_time from notification_rules where rule_key = 'hotel.hcn') <> time '14:00' then
    raise exception '355: the HCN check-in time is not 14:00';
  end if;

  -- rendering, and the refusal of a token that does not exist
  if notif_render('a {x} b', jsonb_build_object('x','Y')) <> 'a Y b' then
    raise exception '355: the renderer does not substitute';
  end if;
  if notif_render('a {nope} b', '{}'::jsonb) <> 'a  b' then
    raise exception '355: an unsupplied token is left in braces';
  end if;

  -- every job must read its rule rather than its own literals
  for v_t in select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public'
                and p.proname in ('generate_hotel_reminders','generate_hotel_hcn_reminders','generate_tafweej_reminders')
  loop
    if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace
         where n2.nspname='public' and p.proname = v_t) not like '%notification_rules%'
    then raise exception '355: % does not read its rule', v_t; end if;
  end loop;
end $chk$;

commit;
