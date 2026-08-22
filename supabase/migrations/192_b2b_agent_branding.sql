-- Agent's own branding for the agent-branded voucher in the portal.
create or replace function public.b2b_agent_branding(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  if a.id is null then return null; end if;
  return jsonb_build_object(
    'agency_name', a.agency_name, 'contact_person', a.contact_person, 'email', a.email,
    'mobile', a.mobile, 'address', a.address, 'logo', a.logo, 'voucher_note', a.voucher_note);
end $function$;
