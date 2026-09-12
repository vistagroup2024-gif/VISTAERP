-- Rollback of 357. Every reminder an admin added goes with it — they exist only
-- as rows in notification_rules, and nothing else in the ERP scans for them, so
-- leaving them would leave reminders nobody would ever send.
--
-- The four shipped reminders keep working: they have their own jobs and read
-- their own rule row, which this does not touch beyond dropping the situation
-- column they were pointed at for display.

begin;

delete from public.notification_rules where not system_rule;

drop function if exists public.notification_rule_create(text, text, text, int[], text, text, text);
drop function if exists public.notification_rule_delete(text);
drop function if exists public.notification_situations_list();
drop function if exists public.generate_custom_reminders(text);

drop table if exists public.notification_reminder_sent;

alter table public.notification_rules
  drop constraint if exists notification_rules_added_needs_situation_chk;
alter table public.notification_rules drop column if exists situation_key;

drop table if exists public.notification_situations;

-- 356's list, restated, because 357 replaced it to carry the situation
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

do $chk$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='notification_rules'
                and column_name='situation_key')
  then raise exception '357 rollback: situation_key is still there'; end if;
end $chk$;

commit;
