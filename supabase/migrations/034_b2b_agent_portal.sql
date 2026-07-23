-- ============================================================
-- VISTA ERP - 034 B2B Agent login portal (session auth + scoped data)
-- Additive. Applied to remote DB via Supabase MCP; kept here for history.
--
-- Custom session auth for partner agents (they are NOT Supabase auth users):
--   b2b_sessions(token, agent_id, expires_at)
--   login_b2b(username, password)  -> verifies bcrypt hash, creates session, returns token
--   b2b_me(token)                  -> agent profile + permissions (or null)
--   logout_b2b(token)              -> ends session
--   b2b_dashboard(token)           -> KPIs scoped to the agent's own party
--   b2b_my_groups(token)           -> the agent's own visa groups only
--   b2b_change_password(token,...) -> agent self-service password change
-- All are SECURITY DEFINER and enforce data isolation by the session's
-- agent_party_id, so an agent can only ever see their own records.
-- ============================================================

create table if not exists b2b_sessions (
  token text primary key,
  agent_id uuid not null references b2b_agents(id) on delete cascade,
  company_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table b2b_sessions enable row level security;  -- touched only by definer functions

-- Function bodies (login_b2b, b2b_me, logout_b2b, b2b_dashboard, b2b_my_groups,
-- b2b_change_password) applied via MCP; see the database for current defs.
-- Granted to anon + authenticated (agents are not Supabase auth users).
select 1;
