-- ============================================================
-- VISTA ERP — Real Web Push notifications (VAPID)
-- Reuses the existing notifications table/bell. A trigger on each new notification
-- calls the app's /api/push/dispatch route (via pg_net), which sends a Web Push
-- message to every registered device for the target audience. Works when the app
-- is closed because the browser push service + service worker deliver it.
-- ============================================================
create extension if not exists pg_net;

-- Exact deep-link for a notification (bell + push both use it; falls back to module/group).
alter table notifications add column if not exists link text;

-- Registered devices. Exactly one of user_id (staff) / agent_id (B2B) is set.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_id uuid references auth.users(id) on delete cascade,   -- staff device
  agent_id uuid references b2b_agents(id) on delete cascade,  -- agent device
  ua text,
  enabled boolean not null default true,
  last_notified timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_user on push_subscriptions(user_id) where user_id is not null;
create index if not exists idx_push_agent on push_subscriptions(agent_id) where agent_id is not null;
alter table push_subscriptions enable row level security;
-- Devices are read/written only through the SECURITY DEFINER RPCs below.
revoke all on push_subscriptions from anon, authenticated;

-- Single-row config the trigger reads (base URL + shared dispatch secret).
create table if not exists push_config (
  id boolean primary key default true check (id),
  base_url text not null,
  dispatch_secret text not null
);
alter table push_config enable row level security;
revoke all on push_config from anon, authenticated;
insert into push_config(id, base_url, dispatch_secret)
values (true, 'https://erp.vista-group.co', '774cae9587ff0bb3c04919dfb7880b94d4d8b134609a6c15')
on conflict (id) do nothing;

-- ── Staff device management (Supabase auth session) ─────────
create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into push_subscriptions(endpoint, p256dh, auth, user_id, ua, enabled)
  values (p_endpoint, p_p256dh, p_auth, auth.uid(), p_ua, true)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id,
        agent_id = null, ua = excluded.ua, enabled = true;
end $$;

create or replace function push_unsubscribe(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

create or replace function push_my_devices()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'endpoint', endpoint, 'ua', ua, 'enabled', enabled, 'last_notified', last_notified, 'created_at', created_at
  ) order by created_at desc), '[]'::jsonb)
  from push_subscriptions where user_id = auth.uid();
$$;

-- Caller's own subscription secrets — used by /api/push test send (own devices only).
create or replace function push_my_subscriptions()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::jsonb)
  from push_subscriptions where user_id = auth.uid() and enabled;
$$;

-- ── Agent device management (B2B token) ─────────────────────
create or replace function b2b_push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  if a.id is null then raise exception 'Not signed in'; end if;
  insert into push_subscriptions(endpoint, p256dh, auth, agent_id, ua, enabled)
  values (p_endpoint, p_p256dh, p_auth, a.id, p_ua, true)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, agent_id = excluded.agent_id,
        user_id = null, ua = excluded.ua, enabled = true;
end $$;

create or replace function b2b_push_unsubscribe(p_token text, p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  delete from push_subscriptions where endpoint = p_endpoint and agent_id = a.id;
end $$;

create or replace function b2b_push_devices(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'endpoint', endpoint, 'ua', ua, 'enabled', enabled, 'last_notified', last_notified, 'created_at', created_at
  ) order by created_at desc), '[]'::jsonb) from push_subscriptions where agent_id = a.id);
end $$;

create or replace function b2b_push_subscriptions(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::jsonb)
    from push_subscriptions where agent_id = a.id and enabled);
end $$;

grant execute on function push_subscribe(text,text,text,text) to authenticated;
grant execute on function push_unsubscribe(text) to authenticated;
grant execute on function push_my_devices() to authenticated;
grant execute on function push_my_subscriptions() to authenticated;
grant execute on function b2b_push_subscribe(text,text,text,text,text) to anon, authenticated;
grant execute on function b2b_push_unsubscribe(text,text) to anon, authenticated;
grant execute on function b2b_push_devices(text) to anon, authenticated;
grant execute on function b2b_push_subscriptions(text) to anon, authenticated;

-- ── Dispatch side (secret-guarded; no service-role key needed) ──
-- Return the notification + its target device subscriptions. Guarded by the shared
-- secret so it is safe to expose to the dispatch route.
create or replace function push_dispatch_targets(p_secret text, p_notification uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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

create or replace function push_mark_notified(p_secret text, p_endpoints text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select dispatch_secret from push_config) then raise exception 'Bad dispatch secret'; end if;
  update push_subscriptions set last_notified = now() where endpoint = any(p_endpoints);
end $$;

-- Remove dead subscriptions (410/404 from the push service).
create or replace function push_prune(p_secret text, p_endpoints text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select dispatch_secret from push_config) then raise exception 'Bad dispatch secret'; end if;
  delete from push_subscriptions where endpoint = any(p_endpoints);
end $$;

grant execute on function push_dispatch_targets(text,uuid) to anon, authenticated;
grant execute on function push_mark_notified(text,text[]) to anon, authenticated;
grant execute on function push_prune(text,text[]) to anon, authenticated;

-- ── Trigger: on each new notification, ping the dispatch route ──
create or replace function tg_notify_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg push_config%rowtype;
begin
  select * into cfg from push_config limit 1;
  if cfg.base_url is null then return new; end if;
  perform net.http_post(
    url := cfg.base_url || '/api/push/dispatch',
    body := jsonb_build_object('id', new.id, 'secret', cfg.dispatch_secret),
    headers := jsonb_build_object('content-type', 'application/json'));
  return new;
exception when others then
  return new;  -- never let push delivery block the notification insert
end $$;

drop trigger if exists trg_notify_push on notifications;
create trigger trg_notify_push after insert on notifications
  for each row execute function tg_notify_push();

-- Feeds return the deep-link too.
create or replace function notifications_feed()
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'category', category, 'title', title, 'body', body, 'module', module,
    'group_id', group_id, 'link', link, 'read', read, 'created_at', created_at
  ) order by created_at desc), '[]'::jsonb)
  from (select * from notifications where audience = 'staff' and not dismissed order by created_at desc limit 100) t;
$$;

create or replace function b2b_notifications_feed(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'category', category, 'title', title, 'body', body, 'module', module,
    'group_id', group_id, 'link', link, 'read', read, 'created_at', created_at
  ) order by created_at desc), '[]'::jsonb)
  from (select * from notifications where audience = 'agent' and agent_id = a.id and not dismissed order by created_at desc limit 100) t);
end $$;
