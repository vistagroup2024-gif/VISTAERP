-- Add group name to the arrival-service list.
drop function if exists public.arrival_compliance(integer);
CREATE FUNCTION public.arrival_compliance(p_days integer DEFAULT 30)
 RETURNS TABLE(id uuid, group_no text, group_name text, arrival_date date, pax integer, agency text, arrival_service text, days_to_arrival integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select g.id, g.group_no, g.group_name, g.arrival_date, g.pax,
         coalesce(a.agency_name, p.name) as agency, g.arrival_service,
         (g.arrival_date - current_date) as days_to_arrival
  from umrah_groups g
  left join b2b_agents a on a.agent_party_id = g.agent_id
  left join parties p on p.id = g.agent_id
  where g.company_id = auth_company_id()
    and coalesce(g.workflow_status,'pending') <> 'rejected'
    and g.arrival_date is not null and g.arrival_date >= current_date
    and g.arrival_date <= current_date + p_days
    and arrival_service_state(g.id) = 'pending'
  order by g.arrival_date;
$function$;
