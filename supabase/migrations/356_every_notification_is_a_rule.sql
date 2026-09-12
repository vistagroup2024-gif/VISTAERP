-- All seventeen notifications on the screen, not four.
--
-- 355 made the four SCHEDULED reminders editable because they are the ones with
-- hours to change. The other thirteen fire on an event, and I left them off the
-- screen — which is not what "control of notifications" means to anyone using
-- it. Being able to stop "Drivers assigned" going out, or to reword it, is
-- exactly as useful as changing an hour.
--
-- HOW THEY GOT ON THE SCREEN WITHOUT REWRITING THIRTEEN ROUTINES.
--
-- The obvious way is to thread a rule key through every sender. Several of those
-- routines are long (gl_submit, transport_assign_trip), and restating twelve
-- large function bodies to change one string in each is twelve chances to break
-- something that works today, for the gain of editing a sentence.
--
-- So the resolution happens in push_notification — the one door they all go
-- through. Each event rule carries a MATCH_TITLE: the literal prefix its sender
-- emits. On the way in, the notification's title is matched against those
-- prefixes (longest first), and the rule that owns it decides whether it is sent
-- at all and what it says.
--
-- WHY EDITING THE TEXT CANNOT BREAK THE MATCH, which is the obvious trap:
-- match_title is a separate column from title, and the save routine does not let
-- it be changed. The admin edits `title`; the matching keeps using
-- `match_title`. Rename "Driver updated" to "Driver changed" and it still
-- matches, because what the code emits has not moved.
--
-- WHAT AN EVENT RULE CAN AND CANNOT DO, said plainly because the screen must not
-- promise more:
--
--   enabled  — exact. Nothing is written and no phone buzzes.
--   title    — fully editable. {ref} is the record it names: the booking number
--              in "Driver updated — TRP-000082", the group in "New Visa Group
--              4809…". Everything after the matched prefix.
--   body     — editable, with {default} standing for the sentence the ERP built.
--              It can be replaced, or wrapped ("ACTION: {default}"), but it
--              cannot be re-composed from individual fields: the booking number,
--              the guest and the dates are assembled inside the routine that
--              fires, and only the finished sentence reaches this point. A
--              reminder rule does not have that limit — its body is templated
--              from real placeholders.
--
-- AND hotel.details_staff GOES TO 48h AND 24h, matching the agent, as asked. It
-- was a single 24h escalation; staff now hear it at the same two distances the
-- agent does.

begin;

alter table public.notification_rules
  add column if not exists kind        text not null default 'reminder',
  add column if not exists match_title text,
  add column if not exists system_rule boolean not null default true,
  add column if not exists sends_ref   boolean not null default false;

alter table public.notification_rules
  drop constraint if exists notification_rules_kind_chk;
alter table public.notification_rules
  add constraint notification_rules_kind_chk check (kind in ('reminder','event'));

-- A reminder needs hours; an event must not have them, and needs the prefix its
-- sender emits. Stated as a constraint so a malformed row cannot exist.
alter table public.notification_rules
  drop constraint if exists notification_rules_shape_chk;
alter table public.notification_rules
  add constraint notification_rules_shape_chk check (
    (kind = 'reminder' and array_length(thresholds, 1) is not null and match_title is null)
    or
    (kind = 'event' and coalesce(array_length(thresholds, 1), 0) = 0 and match_title is not null)
  );

create unique index if not exists notification_rules_match_idx
  on public.notification_rules (audience, category, module, match_title)
  where kind = 'event';

-- ── as asked: staff hear it at 48h and 24h, like the agent ─────────────────
update public.notification_rules
   set thresholds = array[48,24]
 where rule_key = 'hotel.details_staff';

-- ── the thirteen event notifications ───────────────────────────────────────
-- match_title is the literal each sender emits. {ref} in the title is whatever
-- follows it. Seeded to read exactly as they do today, so nothing changes until
-- somebody edits one.
insert into public.notification_rules
  (rule_key, label, module, category, audience, kind, match_title, thresholds,
   anchor_label, title, body, placeholders, sends_ref) values

  ('acct.awaiting', 'Voucher awaiting authorisation', 'accounting', 'accounting', 'staff',
   'event', 'Voucher awaiting authorisation', '{}',
   'a voucher being held for approval',
   'Voucher awaiting authorisation', '{default}', array['default','ref'], false),
  ('acct.approved', 'Voucher authorised & posted', 'accounting', 'accounting', 'staff',
   'event', 'Voucher authorised & posted', '{}',
   'a voucher being approved',
   'Voucher authorised & posted', '{default}', array['default','ref'], false),
  ('acct.rejected', 'Voucher rejected', 'accounting', 'accounting', 'staff',
   'event', 'Voucher rejected', '{}',
   'a voucher being rejected',
   'Voucher rejected', '{default}', array['default','ref'], false),

  ('visa.new_group', 'New visa group submitted by an agent', 'visa', 'visa', 'staff',
   'event', 'New Visa Group ', '{}',
   'an agent submitting a group from the portal',
   'New Visa Group {ref}', '{default}', array['default','ref'], true),
  ('visa.payment_required', 'Payment required (to the agent)', 'visa', 'system', 'agent',
   'event', 'Payment required · ', '{}',
   'a group moving to payment pending',
   'Payment required · {ref}', '{default}', array['default','ref'], true),
  ('visa.group_rejected', 'Group rejected (to the agent)', 'visa', 'system', 'agent',
   'event', 'Group rejected · ', '{}',
   'a group being rejected',
   'Group rejected · {ref}', '{default}', array['default','ref'], true),

  ('transport.drivers_assigned', 'Drivers assigned (to the agent)', 'transport', 'transport', 'agent',
   'event', 'Drivers assigned', '{}',
   'staff confirming the day''s driver assignments',
   'Drivers assigned', '{default}', array['default','ref'], false),
  ('transport.driver_updated', 'Driver updated (to the agent)', 'transport', 'transport', 'agent',
   'event', 'Driver updated — ', '{}',
   'a driver changing after assignments were confirmed',
   'Driver updated — {ref}', '{default}', array['default','ref'], true),
  ('transport.cancel_requested', 'Cancellation requested (to staff)', 'transport', 'transport', 'staff',
   'event', 'Cancellation requested — ', '{}',
   'an agent asking to cancel a booking',
   'Cancellation requested — {ref}', '{default}', array['default','ref'], true),
  ('transport.cancel_approved', 'Cancellation approved (to the agent)', 'transport', 'transport', 'agent',
   'event', 'Cancellation approved — ', '{}',
   'staff approving a cancellation',
   'Cancellation approved — {ref}', '{default}', array['default','ref'], true),
  ('transport.cancel_declined', 'Cancellation declined (to the agent)', 'transport', 'transport', 'agent',
   'event', 'Cancellation declined — ', '{}',
   'staff declining a cancellation',
   'Cancellation declined — {ref}', '{default}', array['default','ref'], true),

  ('hotel.booking_request', 'New hotel booking request (to staff)', 'hotels', 'hotel', 'staff',
   'event', 'New hotel booking request', '{}',
   'an agent creating a hotel booking',
   'New hotel booking request', '{default}', array['default','ref'], false),
  ('hotel.booking_status', 'Booking status changed (to the agent)', 'hotels', 'hotel', 'agent',
   'event', 'Booking status: ', '{}',
   'staff changing a hotel booking''s status',
   'Booking status: {ref}', '{default}', array['default','ref'], true),
  ('hotel.hcn_shared', 'Hotel confirmation shared (to the agent)', 'hotels', 'hotel', 'agent',
   'event', 'Hotel confirmation (HCN) shared', '{}',
   'staff sharing the HCN',
   'Hotel confirmation (HCN) shared', '{default}', array['default','ref'], false)

on conflict (rule_key) do nothing;

-- ── the door consults the rule ─────────────────────────────────────────────
create or replace function public.notification_rule_for(
  p_audience text, p_category text, p_module text, p_title text)
returns notification_rules
language sql
stable security definer
set search_path to 'public'
as $f$
  select r.* from notification_rules r
   where r.kind = 'event'
     and r.audience = coalesce(p_audience, 'staff')
     and r.category = p_category
     and r.module   = p_module
     and coalesce(p_title, '') like r.match_title || '%'
   -- longest prefix wins, so "Cancellation approved — " is not beaten by a
   -- shorter rule that happens to also match
   order by length(r.match_title) desc
   limit 1;
$f$;
revoke all on function public.notification_rule_for(text, text, text, text) from public, anon;
grant execute on function public.notification_rule_for(text, text, text, text) to authenticated;

create or replace function public.push_notification(
  p_audience text, p_agent_id uuid, p_category text, p_title text, p_body text,
  p_module text, p_group_id uuid, p_link text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rr notification_rules; v_ref text; v_title text; v_body text;
begin
  rr := notification_rule_for(p_audience, p_category, p_module, p_title);

  if rr.rule_key is not null then
    -- switched off: nothing is written, so nothing reaches the bell or a phone
    if not rr.enabled then return; end if;
    -- what the sender's prefix was followed by — the booking, the group number
    v_ref   := btrim(substr(coalesce(p_title, ''), length(rr.match_title) + 1));
    v_title := notif_render(rr.title, jsonb_build_object('ref', v_ref, 'default', coalesce(p_title, '')));
    v_body  := notif_render(rr.body,  jsonb_build_object('ref', v_ref, 'default', coalesce(p_body, '')));
  else
    -- No rule owns this title. Sent as the sender wrote it: an unregistered
    -- notification must still arrive, or adding a sender would silently mute it.
    v_title := p_title;
    v_body  := p_body;
  end if;

  insert into notifications (audience, agent_id, category, title, body, module, group_id, link)
  values (p_audience, p_agent_id, p_category, v_title, v_body, p_module, p_group_id,
          coalesce(nullif(btrim(coalesce(p_link, '')), ''),
                   notification_link(p_audience, p_category, p_module, p_group_id)));
end $function$;

-- ── the list and the save learn about event rules ──────────────────────────
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
    'thresholds', r.thresholds, 'anchor_label', r.anchor_label,
    'anchor_time', case when r.anchor_time is null then null else to_char(r.anchor_time, 'HH24:MI') end,
    'title', r.title, 'titles', r.titles, 'body', r.body, 'placeholders', r.placeholders,
    'updated_at', r.updated_at,
    'updated_by_name', (select full_name from profiles p where p.id = r.updated_by)
  ) order by r.kind, r.module, r.rule_key), '[]'::jsonb)
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
  if not (has_role('admin') or staff_perm_strict('notifications.manage')) then
    raise exception 'You do not have permission to change notification rules';
  end if;

  select * into r from notification_rules where rule_key = p_key;
  if not found then raise exception 'Unknown notification rule'; end if;

  if coalesce(btrim(p_title), '') = '' then raise exception 'The title cannot be empty'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'The message cannot be empty'; end if;

  -- Hours belong to a reminder. An event rule fires when the event happens;
  -- there is no hour to set, and the constraint refuses one.
  if r.kind = 'reminder' then
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
    if coalesce(btrim(coalesce(p_anchor_time,'')), '') = '' then v_time := null;
    else v_time := p_anchor_time::time; end if;
  else
    v_th := '{}'; v_time := null;
  end if;

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

  -- An event rule whose title names a record must keep saying which: dropping
  -- {ref} from "Driver updated — {ref}" leaves every one of them identical in
  -- the bell.
  if r.kind = 'event' and r.sends_ref and coalesce(p_title,'') not like '%{ref}%' then
    raise exception 'Keep {ref} in the title — it is the booking or group this notification is about';
  end if;

  update notification_rules
     set enabled = coalesce(p_enabled, enabled),
         thresholds = v_th, anchor_time = v_time,
         title = btrim(p_title), titles = coalesce(p_titles, '{}'::jsonb),
         body = btrim(p_body), updated_at = now(), updated_by = auth.uid()
   where rule_key = p_key
   returning * into r;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (auth_company_id(), auth.uid(), 'notification_rule_changed', 'notification_rule', null,
          jsonb_build_object('rule', p_key, 'enabled', r.enabled, 'thresholds', r.thresholds,
                             'anchor_time', r.anchor_time, 'title', r.title, 'body', r.body));

  return jsonb_build_object('ok', true, 'rule_key', r.rule_key);
end $f$;
revoke all on function public.notification_rules_save(text, boolean, int[], text, text, jsonb, text) from public, anon;
grant execute on function public.notification_rules_save(text, boolean, int[], text, text, jsonb, text) to authenticated;

do $chk$
declare v_n int; v_t text; rr notification_rules;
begin
  select count(*) into v_n from notification_rules;
  if v_n <> 18 then raise exception '356: expected 18 rules (4 reminders + 14 events), found %', v_n; end if;

  select array_to_string(thresholds, ',') into v_t from notification_rules where rule_key = 'hotel.details_staff';
  if v_t <> '48,24' then raise exception '356: staff hotel-details hours are %, not 48,24', v_t; end if;

  -- the matcher must find the right rule, and the longest prefix must win
  rr := notification_rule_for('agent', 'transport', 'transport', 'Cancellation approved — TRP-000455');
  if rr.rule_key <> 'transport.cancel_approved' then
    raise exception '356: matched % for a cancellation approval', coalesce(rr.rule_key,'nothing');
  end if;
  rr := notification_rule_for('staff', 'visa', 'visa', 'New Visa Group 480900458837');
  if rr.rule_key <> 'visa.new_group' then
    raise exception '356: matched % for a new group', coalesce(rr.rule_key,'nothing');
  end if;
  -- and a title nobody owns must resolve to nothing, so it is still sent
  rr := notification_rule_for('staff', 'transport', 'transport', 'Tafweej required · SOMEBODY');
  if rr.rule_key is not null then
    raise exception '356: a reminder title matched the event rule %', rr.rule_key;
  end if;
end $chk$;

commit;
