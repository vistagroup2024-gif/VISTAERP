-- 117 Trigger sync_b2b_owner(): keep the agency Owner user synced with the
-- b2b_agents record Vista edits (username, password, max permissions + manage_users,
-- status). trg_sync_b2b_owner AFTER INSERT OR UPDATE ON b2b_agents. (Applied via MCP.)
create or replace function public.sync_b2b_owner()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_perms jsonb;
begin
  if NEW.username is null then return NEW; end if;
  v_perms := coalesce(NEW.permissions, '{}'::jsonb) || jsonb_build_object('agency.manage_users', true);
  update b2b_agent_users set company_id = NEW.company_id,
    full_name = coalesce(nullif(btrim(NEW.contact_person),''), NEW.agency_name),
    username = NEW.username, password_hash = coalesce(NEW.password_hash, password_hash),
    mobile = NEW.mobile, email = NEW.email, status = NEW.status, permissions = v_perms
  where agent_id = NEW.id and is_owner;
  if not found then
    insert into b2b_agent_users(agent_id, company_id, full_name, username, password_hash, mobile, email, status, is_owner, permissions)
    values (NEW.id, NEW.company_id, coalesce(nullif(btrim(NEW.contact_person),''), NEW.agency_name),
      NEW.username, NEW.password_hash, NEW.mobile, NEW.email, NEW.status, true, v_perms);
  end if;
  return NEW;
end $function$;
drop trigger if exists trg_sync_b2b_owner on b2b_agents;
create trigger trg_sync_b2b_owner after insert or update on b2b_agents
for each row execute function sync_b2b_owner();
