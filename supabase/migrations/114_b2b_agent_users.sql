-- 114 Multi-user B2B: b2b_agent_users (Owner + staff sub-users), session user link,
-- backfill existing agency logins into Owner users, perms-subset helper.
-- (Applied via Supabase MCP; kept for history.)
create table if not exists b2b_agent_users (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references b2b_agents(id) on delete cascade,
  company_id uuid not null, full_name text not null, username text not null unique,
  password_hash text, mobile text, email text, status text not null default 'active',
  is_owner boolean not null default false, permissions jsonb not null default '{}'::jsonb,
  created_by uuid, created_at timestamptz not null default now());
create index if not exists idx_b2b_users_agent on b2b_agent_users(agent_id);
alter table b2b_sessions add column if not exists user_id uuid references b2b_agent_users(id) on delete cascade;
insert into b2b_agent_users (agent_id, company_id, full_name, username, password_hash, mobile, email, status, is_owner, permissions)
select a.id, a.company_id, coalesce(nullif(a.contact_person,''), a.agency_name), a.username, a.password_hash,
       a.mobile, a.email, a.status, true, coalesce(a.permissions,'{}'::jsonb) || jsonb_build_object('agency.manage_users', true)
from b2b_agents a where a.username is not null
  and not exists (select 1 from b2b_agent_users u where u.agent_id = a.id and u.is_owner);
update b2b_sessions s set user_id = u.id from b2b_agent_users u where u.agent_id = s.agent_id and u.is_owner and s.user_id is null;
create or replace function public.b2b_perms_subset(p_child jsonb, p_parent jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select not exists (select 1 from jsonb_each(coalesce(p_child,'{}'::jsonb)) c
    where c.value = 'true'::jsonb and coalesce(p_parent -> c.key,'false'::jsonb) <> 'true'::jsonb);
$$;
