-- ============================================================
-- VISTA ERP - 033 Package history updated-by, B2B agent login, group hotel details
-- Additive. Applied to remote DB via Supabase MCP; kept here for history.
--
-- 1. package_update_history.updated_by_name; mark_package_updated records the
--    updating user's email. (History is now a tab inside Package Updates.)
-- 2. b2b_agents.agent_party_id (link to an existing Customers/Agent party),
--    password_hash; set_b2b_password() hashes with pgcrypto crypt()/bf.
--    (Company field dropped from the agent account — companies are Visa Companies.)
-- 3. umrah_groups.hotel_details jsonb — the agent's original hotel itinerary
--    (city/hotel/check-in/out), reference only, independent of BRN allocation.
-- ============================================================

alter table package_update_history add column if not exists updated_by_name text;
alter table umrah_groups add column if not exists hotel_details jsonb not null default '[]'::jsonb;
alter table b2b_agents add column if not exists agent_party_id uuid references parties(id) on delete set null;
alter table b2b_agents add column if not exists password_hash text;
create extension if not exists pgcrypto with schema extensions;

create or replace function set_b2b_password(p_agent uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if length(coalesce(p_password,'')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update b2b_agents set password_hash = crypt(p_password, gen_salt('bf')) where id = p_agent;
end $$;
revoke all on function set_b2b_password(uuid, text) from anon, public;
grant execute on function set_b2b_password(uuid, text) to authenticated;

-- mark_package_updated body applied via MCP (records updated_by_name).
select 1;
