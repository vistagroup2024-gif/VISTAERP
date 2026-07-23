-- 036_agent_group_form_corrections.sql
-- B2B Agent Visa Group form corrections:
--   1. Group Number: agent-entered & fully editable (no auto-generate/lock); duplicate check preserved.
--   2. Company Selection: expose the Company master list to agents; store selected company on the group.
--   3. Agent Name: auto-assigned to the logged-in agent in the background (no user input).
--   4. Admin View: agent_id remains stored so the Admin Portal still shows which agent created the group.

-- Company master list for the agent Company dropdown.
CREATE OR REPLACE FUNCTION public.b2b_companies(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform b2b_agent_of(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]')
          from group_companies where is_active = true);
end $function$;

GRANT EXECUTE ON FUNCTION public.b2b_companies(text) TO anon, authenticated;

-- Create: agent-entered group_no (required, unique) + selected company; agent auto-assigned.
CREATE OR REPLACE FUNCTION public.b2b_create_group(p_token text, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a b2b_agents%rowtype; v_id uuid;
begin
  a := b2b_agent_of(p_token);
  if not (a.permissions ? 'visa.create' and (a.permissions->>'visa.create')::boolean) then raise exception 'No permission to create visa groups'; end if;
  if coalesce(trim(p->>'group_no'),'') = '' then raise exception 'Group number is required'; end if;
  perform set_config('vista.bypass_guard','1',true);
  insert into umrah_groups(company_id, group_no, group_date, agent_id, group_company_id, group_name, pax,
    arrival_date, departure_date, arrival_flight, arrival_from, arrival_airport,
    departure_flight, departure_to, departure_airport, remarks, hotel_details,
    visa_type, workflow_status, brn_status, visa_status)
  values (a.company_id, trim(p->>'group_no'), current_date, a.agent_party_id, nullif(p->>'group_company_id','')::uuid,
    nullif(p->>'group_name',''), coalesce((p->>'pax')::int,0),
    (p->>'arrival_date')::date, (p->>'departure_date')::date, nullif(p->>'arrival_flight',''),
    nullif(p->>'arrival_from',''), nullif(p->>'arrival_airport',''), nullif(p->>'departure_flight',''),
    nullif(p->>'departure_to',''), nullif(p->>'departure_airport',''), nullif(p->>'remarks',''),
    coalesce(p->'hotel_details','[]'::jsonb), 'normal', 'pending', 'pending', 'pending')
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'This Group Number already exists. Please use a unique Group Number.';
end $function$;

-- Update (Pending only): allow editing group_no + company; duplicate check preserved.
CREATE OR REPLACE FUNCTION public.b2b_update_group(p_token text, p_group uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a b2b_agents%rowtype; g umrah_groups%rowtype;
begin
  a := b2b_agent_of(p_token);
  select * into g from umrah_groups where id = p_group and agent_id = a.agent_party_id;
  if not found then raise exception 'Not found'; end if;
  if not (a.permissions ? 'visa.edit_pending' and (a.permissions->>'visa.edit_pending')::boolean) then raise exception 'No permission to edit'; end if;
  if coalesce(g.workflow_status,'pending') <> 'pending' then raise exception 'This group is under process and can no longer be edited.'; end if;
  if coalesce(trim(p->>'group_no'),'') = '' then raise exception 'Group number is required'; end if;
  perform set_config('vista.bypass_guard','1',true);
  update umrah_groups set
    group_no = trim(p->>'group_no'),
    group_company_id = nullif(p->>'group_company_id','')::uuid,
    group_name = nullif(p->>'group_name',''), pax = coalesce((p->>'pax')::int, pax),
    arrival_date = (p->>'arrival_date')::date, departure_date = (p->>'departure_date')::date,
    arrival_flight = nullif(p->>'arrival_flight',''), arrival_from = nullif(p->>'arrival_from',''), arrival_airport = nullif(p->>'arrival_airport',''),
    departure_flight = nullif(p->>'departure_flight',''), departure_to = nullif(p->>'departure_to',''), departure_airport = nullif(p->>'departure_airport',''),
    remarks = nullif(p->>'remarks',''), hotel_details = coalesce(p->'hotel_details', hotel_details)
  where id = p_group;
exception when unique_violation then
  raise exception 'This Group Number already exists. Please use a unique Group Number.';
end $function$;
