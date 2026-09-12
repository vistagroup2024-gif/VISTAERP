-- An admin can now ADD a reminder, not only edit the ones that shipped.
--
-- 355 made four reminders configurable and 356 put the other fourteen event
-- notifications on the same screen. Both stop at editing what exists. "I want a
-- reminder three days before a group arrives" was still a code change.
--
-- THE HONEST SHAPE OF THIS, because the tempting design is a lie. A free-text
-- "when should this fire" box implies the ERP can watch anything, and it cannot:
-- a reminder needs a table to scan, a date to count back from, a condition that
-- says the thing still has not been done, and the fields its sentence is built
-- from. Those four things are code. So what an admin picks from is a REGISTRY OF
-- SITUATIONS the ERP genuinely queries — nine of them, each one a query that
-- already runs or is the same query over the same columns — and what they choose
-- freely is the hours, the audience, the wording and whether it runs.
--
-- The registry is seeded here and by migration only. There is no routine that
-- writes it, and `authenticated` has select on it and nothing else: the SQL the
-- executor runs is never anything a user typed. That is the whole reason a
-- situation is a row rather than a text box.
--
--   group.arriving                 a group's arrival date is coming up
--   group.hotel_details_missing    ... and Hotel Details have not been added
--   group.visa_not_issued          ... and the visa is still pending
--   group.brn_not_allocated        ... and no BRN is allocated
--   hotel.checkin                  a hotel guest is checking in
--   hotel.checkout                 a hotel guest is checking out
--   hotel.hcn_missing              a hotel booking still has no HCN
--   transport.trip                 a transport trip is due
--   transport.tafweej_missing      a Jeddah-airport Umrah arrival has no Tafweej
--
-- ONE EXECUTOR, NOT ONE JOB PER RULE. generate_custom_reminders walks every
-- added rule, runs its situation's query, and applies the rule's own hours,
-- anchor time, audience and wording. A new rule therefore needs no deployment at
-- all — the hourly cron already calls the executor.
--
-- DEDUP IS PER RULE, PER RECORD, PER HOUR, in notification_reminder_sent, the
-- same shape the three shipped jobs use in their own tables. And the tightest
-- threshold reached wins, for the reason 354 and 355 give: after a missed run, a
-- "72 hours to go" notice delivered 10 hours out is not a reminder, it is a lie
-- about the clock.
--
-- WHAT A SITUATION IS NOT. It is not an event. An added rule counts down to a
-- date; it cannot fire the moment somebody presses a button. Making a NEW
-- event-driven notification means the ERP detecting something new, which is a
-- code change, and the screen says so rather than offering a box that quietly
-- never fires.

begin;

-- ── the registry ───────────────────────────────────────────────────────────
-- query_sql returns one row per record that is currently in the situation:
--
--   record_id  uuid        what is deduped on
--   anchor_ts  timestamp   the moment counted back from; a date-only anchor
--                          returns midnight and the rule's anchor_time replaces
--                          the time
--   ref_id     uuid        what the notification should open
--   agent_id   uuid        b2b_agents.id, or null where there is no agent
--   vars       jsonb       the fields the sentence is built from
--
-- $1 is the scan window in days, computed from the rule's widest hour so that
-- raising a reminder to 96h widens the scan with it instead of silently
-- continuing to fire at 24.
create table if not exists public.notification_situations (
  situation_key       text primary key,
  label               text not null,
  detail              text not null,
  module              text not null,
  category            text not null,
  anchor_label        text not null,
  default_anchor_time time,
  audiences           text[] not null default array['staff'],
  placeholders        text[] not null default '{}',
  query_sql           text not null,
  sort                int  not null default 0
);

alter table public.notification_situations enable row level security;
drop policy if exists notification_situations_staff on public.notification_situations;
create policy notification_situations_staff on public.notification_situations
  for select using ((select is_staff()));
grant select on public.notification_situations to authenticated;

insert into public.notification_situations
  (situation_key, label, detail, module, category, anchor_label, default_anchor_time,
   audiences, placeholders, query_sql, sort) values

  ('group.arriving',
   'A group is arriving',
   'Counts down to the arrival date of any Umrah group that has not been rejected.',
   'hotel', 'package', 'group arrival date', null,
   array['staff','agent'], array['group_no','arrival','agency','pax','hours'],
$q$
  select g.id as record_id, (g.arrival_date + time '00:00') as anchor_ts,
         g.id as ref_id, a.id as agent_id,
         jsonb_build_object('group_no', coalesce(g.group_no,''),
                            'arrival', to_char(g.arrival_date,'DD Mon'),
                            'agency', coalesce(a.agency_name,'—'),
                            'pax', coalesce(g.pax,0)::text) as vars
    from umrah_groups g
    left join b2b_agents a on a.agent_party_id = g.agent_id or a.id = g.agent_id
   where coalesce(g.workflow_status,'pending') <> 'rejected'
     and g.arrival_date is not null
     and g.arrival_date >= current_date
     and g.arrival_date <= current_date + $1
$q$, 10),

  ('group.hotel_details_missing',
   'A group is arriving and Hotel Details are missing',
   'The same countdown, limited to groups whose Hotel Details are still empty. This is what the two shipped hotel-details reminders use.',
   'hotel', 'package', 'group arrival date', null,
   array['staff','agent'], array['group_no','arrival','agency','pax','hours'],
$q$
  select g.id as record_id, (g.arrival_date + time '00:00') as anchor_ts,
         g.id as ref_id, a.id as agent_id,
         jsonb_build_object('group_no', coalesce(g.group_no,''),
                            'arrival', to_char(g.arrival_date,'DD Mon'),
                            'agency', coalesce(a.agency_name,'—'),
                            'pax', coalesce(g.pax,0)::text) as vars
    from umrah_groups g
    left join b2b_agents a on a.agent_party_id = g.agent_id or a.id = g.agent_id
   where coalesce(g.workflow_status,'pending') <> 'rejected'
     and g.arrival_date is not null
     and g.arrival_date >= current_date
     and g.arrival_date <= current_date + $1
     and (g.hotel_details is null or jsonb_array_length(coalesce(g.hotel_details,'[]'::jsonb)) = 0)
$q$, 20),

  ('group.visa_not_issued',
   'A group is arriving and the visa is not issued',
   'Groups whose visa_status is still pending as the arrival date approaches.',
   'visa', 'visa', 'group arrival date', null,
   array['staff','agent'], array['group_no','arrival','agency','pax','hours'],
$q$
  select g.id as record_id, (g.arrival_date + time '00:00') as anchor_ts,
         g.id as ref_id, a.id as agent_id,
         jsonb_build_object('group_no', coalesce(g.group_no,''),
                            'arrival', to_char(g.arrival_date,'DD Mon'),
                            'agency', coalesce(a.agency_name,'—'),
                            'pax', coalesce(g.pax,0)::text) as vars
    from umrah_groups g
    left join b2b_agents a on a.agent_party_id = g.agent_id or a.id = g.agent_id
   where coalesce(g.workflow_status,'pending') <> 'rejected'
     and coalesce(g.visa_status,'pending') <> 'issued'
     and g.arrival_date is not null
     and g.arrival_date >= current_date
     and g.arrival_date <= current_date + $1
$q$, 30),

  ('group.brn_not_allocated',
   'A group is arriving and no BRN is allocated',
   'Groups whose brn_status is still pending as the arrival date approaches.',
   'hotel', 'brn', 'group arrival date', null,
   array['staff'], array['group_no','arrival','agency','pax','hours'],
$q$
  select g.id as record_id, (g.arrival_date + time '00:00') as anchor_ts,
         g.id as ref_id, a.id as agent_id,
         jsonb_build_object('group_no', coalesce(g.group_no,''),
                            'arrival', to_char(g.arrival_date,'DD Mon'),
                            'agency', coalesce(a.agency_name,'—'),
                            'pax', coalesce(g.pax,0)::text) as vars
    from umrah_groups g
    left join b2b_agents a on a.agent_party_id = g.agent_id or a.id = g.agent_id
   where coalesce(g.workflow_status,'pending') <> 'rejected'
     and coalesce(g.brn_status,'pending') <> 'allocated'
     and g.arrival_date is not null
     and g.arrival_date >= current_date
     and g.arrival_date <= current_date + $1
$q$, 40),

  ('hotel.checkin',
   'A hotel guest is checking in',
   'Counts down to a hotel booking''s check-in. Check-in is 14:00 Saudi time, so that is the anchor time offered.',
   'hotels', 'hotel', 'hotel check-in', time '14:00',
   array['staff','agent'], array['booking_no','guest','hotel','city','check_in','nights','hours'],
$q$
  select b.id as record_id, (b.check_in + time '00:00') as anchor_ts,
         b.id as ref_id, a.id as agent_id,
         jsonb_build_object('booking_no', coalesce(b.booking_no,''),
                            'guest', coalesce(b.guest_name,''),
                            'hotel', coalesce(b.hotel_name, h.name, 'hotel'),
                            'city', coalesce(b.city::text,''),
                            'check_in', to_char(b.check_in,'DD Mon'),
                            'nights', coalesce(b.nights,0)::text) as vars
    from hotel_bookings b
    left join hotels h on h.id = b.hotel_id
    left join b2b_agents a on a.agent_party_id = b.agent_id or a.id = b.agent_id
   where b.status not in ('completed','cancelled')
     and b.check_in is not null
     and b.check_in >= current_date
     and b.check_in <= current_date + $1
$q$, 50),

  ('hotel.checkout',
   'A hotel guest is checking out',
   'The same bookings, counted down to check-out instead.',
   'hotels', 'hotel', 'hotel check-out', time '12:00',
   array['staff','agent'], array['booking_no','guest','hotel','city','check_out','nights','hours'],
$q$
  select b.id as record_id, (b.check_out + time '00:00') as anchor_ts,
         b.id as ref_id, a.id as agent_id,
         jsonb_build_object('booking_no', coalesce(b.booking_no,''),
                            'guest', coalesce(b.guest_name,''),
                            'hotel', coalesce(b.hotel_name, h.name, 'hotel'),
                            'city', coalesce(b.city::text,''),
                            'check_out', to_char(b.check_out,'DD Mon'),
                            'nights', coalesce(b.nights,0)::text) as vars
    from hotel_bookings b
    left join hotels h on h.id = b.hotel_id
    left join b2b_agents a on a.agent_party_id = b.agent_id or a.id = b.agent_id
   where b.status not in ('completed','cancelled')
     and b.check_out is not null
     and b.check_out >= current_date
     and b.check_out <= current_date + $1
$q$, 60),

  ('hotel.hcn_missing',
   'A hotel booking still has no HCN',
   'Purchase bookings whose hcn_status is pending, counted down to check-in. This is what the shipped HCN escalation uses.',
   'hotels', 'hotel', 'hotel check-in', time '14:00',
   array['staff'], array['booking_no','guest','hotel','city','check_in','nights','hours'],
$q$
  select p.id as record_id, (b.check_in + time '00:00') as anchor_ts,
         b.id as ref_id, null::uuid as agent_id,
         jsonb_build_object('booking_no', coalesce(b.booking_no,''),
                            'guest', coalesce(b.guest_name,''),
                            'hotel', coalesce(b.hotel_name, h.name, 'hotel'),
                            'city', coalesce(b.city::text,''),
                            'check_in', to_char(b.check_in,'DD Mon'),
                            'nights', coalesce(b.nights,0)::text) as vars
    from hotel_purchase_bookings p
    join hotel_bookings b on b.id = p.booking_id
    left join hotels h on h.id = b.hotel_id
   where b.status not in ('completed','cancelled')
     and coalesce(p.hcn_status,'pending') = 'pending'
     and b.check_in is not null
     and b.check_in >= current_date
     and b.check_in <= current_date + $1
$q$, 70),

  ('transport.trip',
   'A transport trip is due',
   'Counts down to the trip''s own date and time, so no anchor time is needed.',
   'transport', 'transport', 'trip date and time', null,
   array['staff','agent'], array['passenger','booking_no','flight','time','date','route','hours'],
$q$
  select t.id as record_id, (t.trip_date + coalesce(t.trip_time, time '00:00')) as anchor_ts,
         t.booking_id as ref_id, a.id as agent_id,
         jsonb_build_object('passenger', coalesce(b.passenger_name, b.booking_no, 'passenger'),
                            'booking_no', coalesce(b.booking_no,''),
                            'flight', coalesce(t.flight_no,'flight'),
                            'time', to_char(coalesce(t.trip_time, time '00:00'),'HH24:MI'),
                            'date', to_char(t.trip_date,'DD Mon'),
                            'route', coalesce(t.route_label,'')) as vars
    from transport_trips t
    join transport_bookings b on b.id = t.booking_id
    left join b2b_agents a on a.agent_party_id = b.agent_id or a.id = b.agent_id
   where t.status not in ('cancelled','completed')
     and t.trip_date is not null
     and t.trip_date >= current_date
     and t.trip_date <= current_date + $1
$q$, 80),

  ('transport.tafweej_missing',
   'A Jeddah-airport Umrah arrival has no Tafweej',
   'The trips the shipped Tafweej reminder watches: a Jeddah-airport Umrah arrival with tafweej_created still false.',
   'transport', 'transport', 'trip date and time', null,
   array['staff'], array['passenger','booking_no','flight','time','date','route','hours'],
$q$
  select t.id as record_id, (t.trip_date + coalesce(t.trip_time, time '00:00')) as anchor_ts,
         t.booking_id as ref_id, null::uuid as agent_id,
         jsonb_build_object('passenger', coalesce(b.passenger_name, b.booking_no, 'passenger'),
                            'booking_no', coalesce(b.booking_no,''),
                            'flight', coalesce(t.flight_no,'flight'),
                            'time', to_char(coalesce(t.trip_time, time '00:00'),'HH24:MI'),
                            'date', to_char(t.trip_date,'DD Mon'),
                            'route', coalesce(t.route_label,'')) as vars
    from transport_trips t
    join transport_bookings b on b.id = t.booking_id
   where coalesce(t.tafweej_created,false) = false
     and t.status not in ('cancelled','completed')
     and t.trip_time is not null
     and t.trip_date is not null
     and t.trip_date >= current_date
     and t.trip_date <= current_date + $1
     and is_jeddah_umrah_arrival(t.route_id, t.passenger_visa_type)
$q$, 90)

-- do UPDATE, not do nothing: a situation is not user data. It is code that
-- happens to live in a row, so re-applying this migration must correct it.
on conflict (situation_key) do update set
  label = excluded.label, detail = excluded.detail,
  module = excluded.module, category = excluded.category,
  anchor_label = excluded.anchor_label, default_anchor_time = excluded.default_anchor_time,
  audiences = excluded.audiences, placeholders = excluded.placeholders,
  query_sql = excluded.query_sql, sort = excluded.sort;

-- ── an added rule names its situation ──────────────────────────────────────
alter table public.notification_rules
  add column if not exists situation_key text references public.notification_situations(situation_key);

-- The four shipped reminders are pointed at the situations they already scan, so
-- the screen can say what each one watches in the same words for all of them.
update public.notification_rules set situation_key = 'group.hotel_details_missing'
 where rule_key in ('hotel.details_agent','hotel.details_staff');
update public.notification_rules set situation_key = 'hotel.hcn_missing'
 where rule_key = 'hotel.hcn';
update public.notification_rules set situation_key = 'transport.tafweej_missing'
 where rule_key = 'transport.tafweej';

-- An ADDED reminder must name a situation, or nothing would ever scan for it.
-- The shipped four have their own jobs, so they are exempt by being system rows.
alter table public.notification_rules
  drop constraint if exists notification_rules_added_needs_situation_chk;
alter table public.notification_rules
  add constraint notification_rules_added_needs_situation_chk check (
    system_rule or kind <> 'reminder' or situation_key is not null
  );

-- ── said once per rule, per record, per hour ───────────────────────────────
create table if not exists public.notification_reminder_sent (
  rule_key  text not null references public.notification_rules(rule_key) on delete cascade,
  record_id uuid not null,
  threshold int  not null,
  sent_at   timestamptz not null default now(),
  primary key (rule_key, record_id, threshold)
);
alter table public.notification_reminder_sent enable row level security;
-- Nobody reads this from the app; it is the executor's own book-keeping and the
-- executor is definer. No policy, so RLS closes it to every client.

-- ── the one executor every added rule runs through ────────────────────────
create or replace function public.generate_custom_reminders(p_secret text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rr notification_rules; s notification_situations; r record;
        v_days int; v_widest int; v_due timestamp; v_hrs numeric;
        th int; v_th int; v_vars jsonb; n int := 0;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;

  for rr in
    select * from notification_rules
     where kind = 'reminder' and not system_rule and enabled and situation_key is not null
     order by rule_key
  loop
    select * into s from notification_situations where situation_key = rr.situation_key;
    if not found then continue; end if;

    select max(h) into v_widest from unnest(rr.thresholds) h;
    if v_widest is null then continue; end if;
    -- One day either side of the widest reminder, so a 48h rule still sees the
    -- record on the day itself.
    v_days := (ceil(v_widest / 24.0) + 1)::int;

    for r in execute s.query_sql using v_days loop
      -- A date-only anchor takes its time of day from the rule; an anchor that
      -- already carries one (a trip time) keeps it.
      v_due := case when rr.anchor_time is not null
                    then r.anchor_ts::date + rr.anchor_time
                    else r.anchor_ts end;
      v_hrs := extract(epoch from (v_due - localtimestamp)) / 3600.0;

      -- The tightest threshold reached, for the reason 354 gives: a late run
      -- must say where we are, not replay a warning whose hour has gone.
      v_th := null;
      for th in select h from unnest(rr.thresholds) h order by h asc loop
        if v_hrs <= th then v_th := th; exit; end if;
      end loop;
      if v_th is null then continue; end if;

      -- An agent reminder with no agent behind the record has nobody to go to.
      if rr.audience = 'agent' and r.agent_id is null then continue; end if;

      if exists (select 1 from notification_reminder_sent d
                  where d.rule_key = rr.rule_key and d.record_id = r.record_id
                    and d.threshold = v_th) then
        continue;
      end if;

      v_vars := coalesce(r.vars, '{}'::jsonb)
                || jsonb_build_object('hours', round(greatest(v_hrs, 0))::text);

      perform push_notification(
        rr.audience,
        case when rr.audience = 'agent' then r.agent_id else null end,
        rr.category,
        notif_render(notif_rule_title(rr, v_th), v_vars),
        notif_render(rr.body, v_vars),
        rr.module, r.ref_id);

      insert into notification_reminder_sent(rule_key, record_id, threshold)
        values (rr.rule_key, r.record_id, v_th) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $function$;
-- Anon-callable and it must be: the scheduler has no session. The secret is the
-- whole gate, exactly as migration 333 established for the other five jobs.
revoke all on function public.generate_custom_reminders(text) from public;
grant execute on function public.generate_custom_reminders(text) to anon, authenticated;

-- ── what the screen offers ────────────────────────────────────────────────
create or replace function public.notification_situations_list()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
    'situation_key', s.situation_key, 'label', s.label, 'detail', s.detail,
    'module', s.module, 'category', s.category, 'anchor_label', s.anchor_label,
    'default_anchor_time', case when s.default_anchor_time is null then null
                                else to_char(s.default_anchor_time, 'HH24:MI') end,
    'audiences', s.audiences, 'placeholders', s.placeholders
  ) order by s.sort, s.situation_key), '[]'::jsonb)
  from notification_situations s where is_staff();
$f$;
revoke all on function public.notification_situations_list() from public, anon;
grant execute on function public.notification_situations_list() to authenticated;

create or replace function public.notification_rule_create(
  p_situation text, p_label text, p_audience text, p_thresholds int[],
  p_anchor_time text, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare s notification_situations; v_key text; v_th int[]; v_time time;
        v_bad text; t text; v_seq int := 1;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  if not (has_role('admin') or staff_perm_strict('notifications.manage')) then
    raise exception 'You do not have permission to add notification rules';
  end if;

  select * into s from notification_situations where situation_key = p_situation;
  if not found then raise exception 'Unknown situation'; end if;

  if not (coalesce(p_audience,'staff') = any (s.audiences)) then
    raise exception 'This situation cannot notify %. It can notify: %',
      coalesce(p_audience,'staff'), array_to_string(s.audiences, ', ');
  end if;

  if coalesce(btrim(p_label), '') = '' then raise exception 'Give the reminder a name'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'The title cannot be empty'; end if;
  if coalesce(btrim(p_body), '')  = '' then raise exception 'The message cannot be empty'; end if;

  select coalesce(array_agg(distinct h order by h desc), '{}') into v_th
    from unnest(coalesce(p_thresholds, '{}'::int[])) h where h > 0;
  if array_length(v_th, 1) is null then
    raise exception 'Give at least one reminder time, in hours before the %', s.anchor_label;
  end if;
  if array_length(v_th, 1) > 6 then raise exception 'Six reminder times is the most this can carry'; end if;
  if (select max(h) from unnest(v_th) h) > 720 then
    raise exception 'A reminder more than 30 days ahead is not a reminder';
  end if;

  if coalesce(btrim(coalesce(p_anchor_time,'')), '') = '' then v_time := null;
  else v_time := p_anchor_time::time; end if;

  -- The same placeholder check the edit does, for the same reason: a token this
  -- situation does not supply renders as nothing and the sentence reads wrong.
  for t in select m[1] from regexp_matches(coalesce(p_title,'') || ' ' || coalesce(p_body,''),
                                           '\{([a-z_]+)\}', 'g') m
  loop
    if not (t = any (s.placeholders)) then
      v_bad := coalesce(v_bad || ', ', '') || '{' || t || '}';
    end if;
  end loop;
  if v_bad is not null then
    raise exception 'Unknown placeholder %. This situation offers: %',
      v_bad, '{' || array_to_string(s.placeholders, '} {') || '}';
  end if;

  -- A key of its own, so an added rule can never collide with a shipped one and
  -- the event matcher can never reach it.
  v_key := 'custom.' || p_situation || '.' || coalesce(p_audience,'staff');
  while exists (select 1 from notification_rules where rule_key = v_key || '.' || v_seq) loop
    v_seq := v_seq + 1;
  end loop;
  v_key := v_key || '.' || v_seq;

  insert into notification_rules
    (rule_key, label, module, category, audience, kind, enabled, system_rule,
     situation_key, thresholds, anchor_label, anchor_time,
     title, titles, body, placeholders, updated_at, updated_by)
  values
    (v_key, btrim(p_label), s.module, s.category, coalesce(p_audience,'staff'),
     'reminder', true, false, s.situation_key, v_th, s.anchor_label, v_time,
     btrim(p_title), '{}'::jsonb, btrim(p_body), s.placeholders, now(), auth.uid());

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (auth_company_id(), auth.uid(), 'notification_rule_added', 'notification_rule', null,
          jsonb_build_object('rule', v_key, 'situation', s.situation_key,
                             'audience', coalesce(p_audience,'staff'), 'thresholds', v_th,
                             'title', btrim(p_title), 'body', btrim(p_body)));

  return jsonb_build_object('ok', true, 'rule_key', v_key);
end $f$;
revoke all on function public.notification_rule_create(text, text, text, int[], text, text, text) from public, anon;
grant execute on function public.notification_rule_create(text, text, text, int[], text, text, text) to authenticated;

-- Only an added rule can be deleted. A shipped one is switched off instead —
-- deleting it would leave the job that reads it with no rule at all.
create or replace function public.notification_rule_delete(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare r notification_rules;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  if not (has_role('admin') or staff_perm_strict('notifications.manage')) then
    raise exception 'You do not have permission to change notification rules';
  end if;

  select * into r from notification_rules where rule_key = p_key;
  if not found then raise exception 'Unknown notification rule'; end if;
  if r.system_rule then
    raise exception 'This notification is part of the ERP. Switch it off rather than deleting it.';
  end if;

  delete from notification_rules where rule_key = p_key;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (auth_company_id(), auth.uid(), 'notification_rule_deleted', 'notification_rule', null,
          jsonb_build_object('rule', p_key, 'label', r.label, 'situation', r.situation_key));

  return jsonb_build_object('ok', true);
end $f$;
revoke all on function public.notification_rule_delete(text) from public, anon;
grant execute on function public.notification_rule_delete(text) to authenticated;

-- The list carries the situation, so the screen can say what a rule watches and
-- offer the right placeholders for it.
create or replace function public.notification_rules_list()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rule_key', r.rule_key, 'label', r.label, 'module', r.module, 'category', r.category,
    'audience', r.audience, 'kind', r.kind, 'enabled', r.enabled,
    'system_rule', r.system_rule, 'sends_ref', r.sends_ref,
    'situation_key', r.situation_key,
    'situation_label', (select s.label from notification_situations s
                         where s.situation_key = r.situation_key),
    'thresholds', r.thresholds, 'anchor_label', r.anchor_label,
    'anchor_time', case when r.anchor_time is null then null else to_char(r.anchor_time, 'HH24:MI') end,
    'title', r.title, 'titles', r.titles, 'body', r.body, 'placeholders', r.placeholders,
    'updated_at', r.updated_at,
    'updated_by_name', (select full_name from profiles p where p.id = r.updated_by)
  ) order by r.kind, r.system_rule desc, r.module, r.rule_key), '[]'::jsonb)
  from notification_rules r where is_staff();
$f$;
revoke all on function public.notification_rules_list() from public, anon;
grant execute on function public.notification_rules_list() to authenticated;

do $chk$
declare v_n int; rr notification_rules; s notification_situations; v_cnt int;
begin
  select count(*) into v_n from notification_situations;
  if v_n <> 9 then raise exception '357: expected 9 situations, found %', v_n; end if;

  -- Every situation's SQL must actually run, with the $1 the executor passes.
  -- A seeded query that does not compile would be a reminder that silently
  -- never fires, which is the one outcome this whole migration exists to avoid.
  for s in select * from notification_situations order by sort loop
    begin
      execute 'select count(*) from (' || s.query_sql || ') q' into v_cnt using 3;
    exception when others then
      raise exception '357: situation % does not run: %', s.situation_key, sqlerrm;
    end;
  end loop;

  -- The four shipped reminders must each name the situation they scan.
  select count(*) into v_n from notification_rules
   where kind = 'reminder' and situation_key is null;
  if v_n <> 0 then raise exception '357: % reminder rule(s) name no situation', v_n; end if;

  -- And the constraint must refuse an added reminder with no situation.
  begin
    insert into notification_rules
      (rule_key, label, module, category, audience, kind, system_rule, thresholds,
       anchor_label, title, body)
    values ('zz.test', 'x', 'm', 'c', 'staff', 'reminder', false, array[24], 'a', 't', 'b');
    raise exception '357: an added reminder with no situation was accepted';
  exception when check_violation then null;
  end;
end $chk$;

commit;
