-- ROLLBACK for 341. Restores the broadcast behaviour exactly as it was: every
-- staff member sees and is pushed every staff notification, and read/dismissed
-- go back to being one shared flag per row.
--
-- `notification_reads` is DROPPED, and with it whatever each person had marked
-- read since 341 ran. That is the honest cost of going back — the old feed has
-- nowhere to put per-user state — and it is why this drops the table rather
-- than leaving it orphaned to confuse the next reader. The legacy read /
-- dismissed columns on `notifications` were never written by 341, so they are
-- exactly as they were before it.

begin;

create or replace function public.notifications_feed()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'category', category, 'title', title, 'body', body, 'module', module,
    'group_id', group_id, 'link', link, 'read', read, 'created_at', created_at
  ) order by created_at desc), '[]'::jsonb)
  from (select * from notifications where audience = 'staff' and not dismissed order by created_at desc limit 100) t;
$$;

create or replace function public.notifications_mark(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$ begin
  if p_action = 'read' then update notifications set read = true where id = p_id and audience = 'staff';
  elsif p_action = 'dismiss' then update notifications set dismissed = true where id = p_id and audience = 'staff';
  elsif p_action = 'read_all' then update notifications set read = true where audience = 'staff' and not read;
  end if;
end $$;

create or replace function public.push_dispatch_targets(p_secret text, p_notification uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare n notifications%rowtype; subs jsonb;
begin
  if p_secret is null or p_secret <> (select dispatch_secret from push_config) then
    raise exception 'Bad dispatch secret';
  end if;
  select * into n from notifications where id = p_notification;
  if not found then return jsonb_build_object('found', false); end if;
  if n.audience = 'agent' then
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::jsonb)
      into subs from push_subscriptions where agent_id = n.agent_id and enabled;
  else
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::jsonb)
      into subs from push_subscriptions where user_id is not null and enabled;
  end if;
  return jsonb_build_object('found', true,
    'title', n.title, 'body', n.body, 'category', n.category, 'module', n.module,
    'link', coalesce(n.link, case when n.audience='agent' then '/agent' else '/dashboard' end),
    'subs', subs);
end $$;

drop function if exists public.staff_sees_module(text);
drop function if exists public.staff_user_sees_module(uuid, text);
drop table if exists public.notification_reads;

do $chk$
begin
  if to_regclass('public.notification_reads') is not null then
    raise exception '341 rollback: notification_reads still exists'; end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
       where ns.nspname='public' and p.proname='notifications_feed') like '%staff_sees_module%'
  then raise exception '341 rollback: notifications_feed is still filtered'; end if;
end $chk$;

commit;
