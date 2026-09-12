-- Undo 352. Every user goes back to being told everything their module rights
-- allow, and the preferences they set are dropped with the column.
--
-- The bell feed and the push dispatcher are restored to asking
-- staff_user_sees_module directly, which is what they did before.

begin;

drop function if exists public.notify_prefs_save(text[], uuid);
drop function if exists public.notify_prefs_get(uuid);

create or replace function public.notifications_feed()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'category',category,'title',title,'body',body,
    'module',module,'group_id',group_id,'link',link,'read',read,'created_at',created_at)
    order by created_at desc), '[]'::jsonb)
  from (select n.id,n.category,n.title,n.body,n.module,n.group_id,n.link,n.created_at,
               (n.read or coalesce(r.read,false)) as read
          from notifications n
          left join notification_reads r on r.notification_id=n.id and r.user_id=auth.uid()
         where n.audience='staff' and not n.dismissed and not coalesce(r.dismissed,false)
           and staff_sees_module(n.module)
         order by n.created_at desc limit 100) t;
$function$;

create or replace function public.push_dispatch_targets(p_secret text, p_notification uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
    select coalesce(jsonb_agg(jsonb_build_object('endpoint',ps.endpoint,'p256dh',ps.p256dh,'auth',ps.auth)),'[]'::jsonb)
      into subs from push_subscriptions ps
     where ps.user_id is not null and ps.enabled and staff_user_sees_module(ps.user_id, n.module);
  end if;
  return jsonb_build_object('found',true,'title',n.title,'body',n.body,'category',n.category,
    'module',n.module,'link',coalesce(n.link, case when n.audience='agent' then '/agent' else '/dashboard' end),
    'subs',subs);
end $function$;

drop function if exists public.staff_user_wants_notification(uuid, text, text);
drop function if exists public.notification_categories();

alter table public.profiles drop column if exists notify_off;

commit;
