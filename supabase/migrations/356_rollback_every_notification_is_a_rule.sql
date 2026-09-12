-- Rollback of 356. Takes the fourteen event rules off the screen and puts
-- push_notification back to the form 353 left it in, so a notification is again
-- written exactly as its sender wrote it.
--
-- The staff hotel-details hours go back to a single 24h escalation. That was the
-- state before 356 and it is what the shipped generator expects to find; the two
-- extra hours are a setting, not data, so restoring them loses nothing that was
-- typed in.
--
-- Run 357's rollback FIRST if 357 has been applied — its added rules reference
-- columns this drops.

begin;

delete from public.notification_rules where kind = 'event';

update public.notification_rules
   set thresholds = array[24]
 where rule_key = 'hotel.details_staff';

drop function if exists public.notification_rule_for(text, text, text, text);

-- back to 353's form: one insert, no rule consulted
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

drop index if exists public.notification_rules_match_idx;
alter table public.notification_rules drop constraint if exists notification_rules_shape_chk;
alter table public.notification_rules drop constraint if exists notification_rules_kind_chk;
alter table public.notification_rules
  drop column if exists sends_ref,
  drop column if exists system_rule,
  drop column if exists match_title,
  drop column if exists kind;

-- 355's list and save, restated, because 356 replaced both
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
  if not (has_role('admin') or staff_perm_strict('notifications.manage')) then
    raise exception 'You do not have permission to change notification rules';
  end if;

  select * into r from notification_rules where rule_key = p_key;
  if not found then raise exception 'Unknown notification rule'; end if;

  if coalesce(btrim(p_title), '') = '' then raise exception 'The title cannot be empty'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'The message cannot be empty'; end if;

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
         thresholds = v_th, anchor_time = v_time,
         title = btrim(p_title), titles = coalesce(p_titles, '{}'::jsonb),
         body = btrim(p_body), updated_at = now(), updated_by = auth.uid()
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

do $chk$
declare v_n int;
begin
  select count(*) into v_n from notification_rules;
  if v_n <> 4 then raise exception '356 rollback: expected 4 rules, found %', v_n; end if;
end $chk$;

commit;
