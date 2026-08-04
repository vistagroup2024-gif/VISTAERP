-- ============================================================
-- VISTA ERP - 112 Agent dashboard: arrival_services_pending count
-- (Applied via Supabase MCP; kept for history.) See 110/111 for the compliance logic.
-- ============================================================
create or replace function public.b2b_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s b2b_sessions%rowtype; a b2b_agents%rowtype; v jsonb; pid uuid;
begin
  select * into s from b2b_sessions where token = p_token and expires_at > now();
  if not found then raise exception 'Session expired'; end if;
  select * into a from b2b_agents where id = s.agent_id;
  pid := a.agent_party_id;
  select jsonb_build_object(
    'total_applications', (select count(*) from umrah_groups g where g.agent_id = pid),
    'pending_visas', (select count(*) from umrah_groups g where g.agent_id = pid and g.visa_status <> 'issued'),
    'visa_issued', (select count(*) from umrah_groups g where g.agent_id = pid and g.visa_status = 'issued'),
    'pending_package_updates', (select count(*) from umrah_groups g where g.agent_id = pid and g.package_status in ('update_required','update_available','update_ready')),
    'arrival_services_pending', (select count(*) from umrah_groups g where g.agent_id = pid
        and coalesce(g.workflow_status,'pending') <> 'rejected' and g.arrival_date is not null
        and g.arrival_date >= current_date and g.arrival_date <= current_date + 30
        and arrival_service_state(g.id) = 'pending'),
    'total_pax', (select coalesce(sum(pax),0) from umrah_groups g where g.agent_id = pid),
    'credit_limit', a.credit_limit, 'currency', a.currency
  ) into v;
  return v;
end $function$;
