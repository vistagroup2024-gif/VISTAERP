-- 115 Route B2B auth through the acting user. (Applied via Supabase MCP.)
create or replace function public.login_b2b(p_username text, p_password text)
returns text language plpgsql security definer set search_path to 'public','extensions' as $function$
declare u b2b_agent_users%rowtype; a b2b_agents%rowtype; v_token text;
begin
  select * into u from b2b_agent_users where lower(username) = lower(p_username) limit 1;
  if not found or u.password_hash is null then raise exception 'Invalid username or password'; end if;
  if u.status <> 'active' then raise exception 'This user is inactive. Contact your agency owner.'; end if;
  select * into a from b2b_agents where id = u.agent_id;
  if not found then raise exception 'Invalid username or password'; end if;
  if a.status <> 'active' then raise exception 'This account is inactive. Contact Vista Group.'; end if;
  if a.locked then raise exception 'This account is locked. Contact Vista Group.'; end if;
  if crypt(p_password, u.password_hash) <> u.password_hash then raise exception 'Invalid username or password'; end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into b2b_sessions(token, agent_id, company_id, user_id) values (v_token, a.id, a.company_id, u.id);
  insert into b2b_activity(company_id, agent_id, kind, detail) values (a.company_id, a.id, 'login', 'Portal login: ' || u.full_name);
  return v_token;
end $function$;

create or replace function public.b2b_me(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare a b2b_agents%rowtype; s b2b_sessions%rowtype; u b2b_agent_users%rowtype;
begin
  select * into s from b2b_sessions where token = p_token and expires_at > now();
  if not found then return null; end if;
  select * into a from b2b_agents where id = s.agent_id;
  if not found or a.status <> 'active' or a.locked then return null; end if;
  if s.user_id is not null then
    select * into u from b2b_agent_users where id = s.user_id;
    if not found or u.status <> 'active' then return null; end if;
  end if;
  return jsonb_build_object('id', a.id, 'agency_name', a.agency_name, 'agent_party_id', a.agent_party_id,
    'email', a.email, 'mobile', a.mobile, 'currency', a.currency, 'credit_limit', a.credit_limit,
    'user_id', u.id, 'full_name', coalesce(u.full_name, a.agency_name), 'username', u.username,
    'is_owner', coalesce(u.is_owner, true), 'permissions', coalesce(u.permissions, a.permissions));
end $function$;

create or replace function public.b2b_agent_of(p_token text)
returns b2b_agents language plpgsql stable security definer set search_path to 'public' as $function$
declare s b2b_sessions%rowtype; a b2b_agents%rowtype; u b2b_agent_users%rowtype;
begin
  select * into s from b2b_sessions where token = p_token and expires_at > now();
  if not found then raise exception 'Session expired'; end if;
  if s.user_id is not null then
    select * into u from b2b_agent_users where id = s.user_id;
    if not found or u.status <> 'active' then raise exception 'Account unavailable'; end if;
  end if;
  select * into a from b2b_agents where id = s.agent_id and status = 'active' and not locked;
  if not found then raise exception 'Account unavailable'; end if;
  return a;
end $function$;
