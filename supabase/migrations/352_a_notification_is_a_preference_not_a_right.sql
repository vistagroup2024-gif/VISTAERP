-- Whether you CAN see something and whether you WANT to be told are two
-- different questions, and the ERP was only asking the first.
--
-- Notification visibility is derived from module RIGHTS: staff_user_sees_module
-- reads profiles.permissions and shows a notification to anyone holding any
-- permission under that module's prefix. That was the right fix for the problem
-- it solved — Saad has only transport, so Saad should not be told about hotels —
-- but it has no answer for the opposite case. A manager holds every right, so a
-- manager is told everything: 219 "Visa issued" notices and the one "Voucher
-- awaiting your authorisation" arrive through the same door, and the useful one
-- is buried.
--
-- So a second, independent control: what each user WANTS. Rights decide the
-- ceiling; the preference can only narrow it.
--
-- THE PREFERENCE CAN ONLY TURN THINGS OFF, and that asymmetry is the whole
-- safety property. A user cannot tick themselves into hotel notifications when
-- they hold no hotel rights — notify_off is a list of what to SUPPRESS, so a
-- category absent from it is not "granted", it is merely "not suppressed", and
-- the rights test still has to pass. There is no combination of preferences
-- that shows somebody something they could not already see.
--
-- EMPTY MEANS EVERYTHING, matching the convention everywhere else in this
-- schema except dashboard cards and the users.* keys. A new user is told
-- everything they are entitled to and turns off what they do not want, rather
-- than starting deaf and having to discover the setting.
--
-- WHY CATEGORY AND NOT MODULE. The rights filter works on module (visa,
-- transport, hotels, brn). Category is finer and is already recorded on every
-- row: 'accounting' separates voucher authorisation from everything else, and
-- 'system' separates a payment demand from a visa status change — both inside
-- the visa module. That is exactly the grain a manager needs. No sender had to
-- change; the column was already being filled correctly.
--
-- WHAT THIS STILL CANNOT DO, stated plainly: it cannot separate "Visa issued"
-- from "Package update required", because both are category 'visa' and nothing
-- on the row distinguishes them but the title text. Splitting those needs a
-- type key set by each sender — a code change, not configuration.
--
-- ONE FILTER, BOTH DOORS. The bell feed and the phone push each had their own
-- copy of the visibility test. They now call the same function, so a
-- notification cannot be hidden from the bell and still arrive on the phone.

begin;

alter table public.profiles
  add column if not exists notify_off text[] not null default '{}';

comment on column public.profiles.notify_off is
  'Notification categories this user has switched OFF. Empty = everything their module rights allow. It can only suppress, never grant.';

-- ── the catalogue ──────────────────────────────────────────────────────────
-- In SQL so the settings screen and the filter read one list. Each row says
-- which module right gates it, which is what the screen uses to show a user
-- that a category is unavailable to them for reasons a preference cannot fix.
create or replace function public.notification_categories()
returns jsonb
language sql
immutable
as $f$
  select jsonb_build_array(
    jsonb_build_object('category','accounting','label','Voucher authorisation',
      'gated_by', null,
      'description','A voucher is waiting on your approval, or one you raised was approved or rejected.'),
    jsonb_build_object('category','visa','label','Visa & groups',
      'gated_by','visa',
      'description','Visa issued, group created, package update required.'),
    jsonb_build_object('category','transport','label','Transport',
      'gated_by','transport',
      'description','Drivers assigned, tafweej required, a cancellation asked for.'),
    jsonb_build_object('category','hotel','label','Hotels',
      'gated_by','hotels',
      'description','Booking confirmed, HCN not received, hotel reminders.'),
    jsonb_build_object('category','brn','label','BRN allocation',
      'gated_by','brn',
      'description','BRNs allocated to a group.'),
    jsonb_build_object('category','package','label','Package updates',
      'gated_by','visa',
      'description','A group''s package needs updating.'),
    jsonb_build_object('category','system','label','Payments & system',
      'gated_by', null,
      'description','Payment required, and anything the ERP raises that is not one of the above.')
  );
$f$;

-- ── rights AND preference, in one place ────────────────────────────────────
create or replace function public.staff_user_wants_notification(
  p_user uuid, p_module text, p_category text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $f$
  select staff_user_sees_module(p_user, p_module)
     and not (coalesce(p_category, '') = any (
           coalesce((select notify_off from profiles where id = p_user), '{}'::text[])));
$f$;
revoke all on function public.staff_user_wants_notification(uuid, text, text) from public, anon;
grant execute on function public.staff_user_wants_notification(uuid, text, text) to authenticated;

-- ── the bell ───────────────────────────────────────────────────────────────
create or replace function public.notifications_feed()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'category',category,'title',title,'body',body,
    'module',module,'group_id',group_id,'link',link,'read',read,'created_at',created_at)
    order by created_at desc), '[]'::jsonb)
  from (select n.id,n.category,n.title,n.body,n.module,n.group_id,n.link,n.created_at,
               (n.read or coalesce(r.read,false)) as read
          from notifications n
          left join notification_reads r on r.notification_id=n.id and r.user_id=auth.uid()
         where n.audience='staff' and not n.dismissed and not coalesce(r.dismissed,false)
           and staff_user_wants_notification(auth.uid(), n.module, n.category)
         order by n.created_at desc limit 100) t;
$function$;

-- ── the phone ──────────────────────────────────────────────────────────────
create or replace function public.push_dispatch_targets(p_secret text, p_notification uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n notifications%rowtype; subs jsonb;
begin
  if p_secret is null or p_secret <> (select dispatch_secret from push_config) then
    raise exception 'Bad dispatch secret'; end if;
  select * into n from notifications where id = p_notification;
  if not found then return jsonb_build_object('found', false); end if;
  if n.audience = 'agent' then
    select coalesce(jsonb_agg(jsonb_build_object('endpoint',endpoint,'p256dh',p256dh,'auth',auth)),'[]'::jsonb)
      into subs from push_subscriptions where agent_id = n.agent_id and enabled;
  else
    -- The same test the bell uses. Two copies of it is how a notification comes
    -- to be hidden in the ERP and still buzz the phone.
    select coalesce(jsonb_agg(jsonb_build_object('endpoint',ps.endpoint,'p256dh',ps.p256dh,'auth',ps.auth)),'[]'::jsonb)
      into subs from push_subscriptions ps
     where ps.user_id is not null and ps.enabled
       and staff_user_wants_notification(ps.user_id, n.module, n.category);
  end if;
  return jsonb_build_object('found',true,'title',n.title,'body',n.body,'category',n.category,
    'module',n.module,'link',coalesce(n.link, case when n.audience='agent' then '/agent' else '/dashboard' end),
    'subs',subs);
end $function$;

-- ── reading and writing the preference ─────────────────────────────────────
-- Returns the catalogue with, for each category, whether this user's RIGHTS
-- allow it at all and whether they have it switched on. A category their rights
-- exclude is shown as unavailable rather than simply missing, so the screen can
-- say why instead of leaving a gap.
create or replace function public.notify_prefs_get(p_user uuid default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $f$
declare v_user uuid; v_off text[]; v_out jsonb := '[]'::jsonb; c jsonb;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  v_user := coalesce(p_user, auth.uid());
  -- Reading somebody else's is an administrative act.
  if v_user <> auth.uid() then perform staff_admin_guard(v_user, 'users.manage_roles'); end if;

  select coalesce(notify_off, '{}') into v_off from profiles where id = v_user;
  if not found then raise exception 'User not found'; end if;

  for c in select * from jsonb_array_elements(notification_categories())
  loop
    v_out := v_out || jsonb_build_array(c || jsonb_build_object(
      'allowed_by_rights', staff_user_sees_module(v_user, c->>'gated_by'),
      'on', not ((c->>'category') = any (v_off))));
  end loop;
  return jsonb_build_object('user_id', v_user, 'categories', v_out);
end $f$;
revoke all on function public.notify_prefs_get(uuid) from public, anon;
grant execute on function public.notify_prefs_get(uuid) to authenticated;

-- Writes ONLY notify_off, and only for the caller unless they administer users.
-- Nobody writes their own profiles row in this schema — profiles_self_update is
-- gone on purpose — so a preference a user is allowed to set for themselves
-- needs its own narrow door rather than a grant on the table.
create or replace function public.notify_prefs_save(p_off text[], p_user uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_user uuid; v_valid text[]; v_clean text[];
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user <> auth.uid() then perform staff_admin_guard(v_user, 'users.manage_roles'); end if;

  -- Only categories that exist. An unknown string would sit in the column
  -- suppressing nothing, and read as a setting that was doing something.
  select array_agg(x->>'category') into v_valid
    from jsonb_array_elements(notification_categories()) x;
  select coalesce(array_agg(distinct v), '{}') into v_clean
    from unnest(coalesce(p_off, '{}'::text[])) v
   where v = any (v_valid);

  update profiles set notify_off = v_clean where id = v_user;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (auth_company_id(), auth.uid(),
          case when v_user = auth.uid() then 'notify_prefs_self' else 'notify_prefs_changed' end,
          'profile', v_user, jsonb_build_object('off', v_clean));

  return jsonb_build_object('ok', true, 'off', v_clean);
end $f$;
revoke all on function public.notify_prefs_save(text[], uuid) from public, anon;
grant execute on function public.notify_prefs_save(text[], uuid) to authenticated;

do $chk$
declare v_admin uuid; v_n int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='notify_off')
  then raise exception '352: notify_off is missing'; end if;

  select count(*) into v_n from jsonb_array_elements(notification_categories());
  if v_n <> 7 then raise exception '352: expected 7 categories, found %', v_n; end if;

  -- Nobody starts suppressed.
  select count(*) into v_n from profiles where coalesce(array_length(notify_off,1),0) > 0;
  if v_n <> 0 then raise exception '352: % profile(s) start with something switched off', v_n; end if;

  -- The preference must not be able to GRANT. Measured, not asserted in a
  -- comment: a user with no rights at all stays unable to see a gated category
  -- however empty their notify_off is.
  select user_id into v_admin from user_roles where role = 'admin'::app_role limit 1;
  if staff_user_wants_notification(v_admin, 'transport', 'transport') is not true then
    raise exception '352: an admin should still want transport notifications';
  end if;
  if staff_user_wants_notification('00000000-0000-0000-0000-000000000000'::uuid, 'transport', 'transport') is not false then
    raise exception '352: an unknown user must not receive anything';
  end if;
end $chk$;

commit;
