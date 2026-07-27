-- ============================================================
-- VISTA ERP - 044 Agent attachments: add until issued
-- Applied to remote DB via Supabase MCP; kept here for history.
--
-- Agents may ADD attachments any time before the visa is issued (including
-- while the group is Under Processing). Deletion stays restricted to the
-- Pending stage (b2b_attachment_delete is unchanged).
-- ============================================================

create or replace function public.b2b_attachment_add(
  p_token text, p_group uuid, p_name text, p_mime text, p_size integer, p_data text
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare a b2b_agents%rowtype; g umrah_groups%rowtype; v uuid;
begin
  a := b2b_agent_of(p_token);
  select * into g from umrah_groups where id = p_group and agent_id = a.agent_party_id;
  if not found then raise exception 'Not found'; end if;
  -- Locked only once the visa has been issued (final stage).
  if coalesce(g.visa_status,'') = 'issued' or coalesce(g.workflow_status,'') = 'visa_issued' then
    raise exception 'This group is locked — attachments can no longer be added.';
  end if;
  if length(coalesce(p_data,'')) > 7000000 then raise exception 'File too large (max ~5 MB).'; end if;
  insert into group_attachments(group_id, name, mime, size, data, uploaded_by, source)
  values (p_group, p_name, p_mime, p_size, p_data, a.agency_name, 'agent') returning id into v;
  return v;
end $function$;
