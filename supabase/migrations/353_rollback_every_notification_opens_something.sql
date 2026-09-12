-- Undo 353. Notifications stop resolving their own link, so the ones that never
-- carried one go back to having no Open button — and the transport ones go back
-- to pointing at /groups/<booking id>, which is a route that cannot resolve.
--
-- Links already written onto existing rows are NOT cleared: they are correct,
-- and blanking them would only re-break what is now working. Clear them by hand
-- if a true before-state is wanted.

begin;

create or replace function public.push_notification(
  p_audience text, p_agent_id uuid, p_category text, p_title text, p_body text,
  p_module text, p_group_id uuid, p_link text)
returns void language sql security definer set search_path to 'public' as $function$
  insert into notifications (audience, agent_id, category, title, body, module, group_id, link)
  values (p_audience, p_agent_id, p_category, p_title, p_body, p_module, p_group_id, p_link);
$function$;

create or replace function public.push_notification(
  p_audience text, p_agent_id uuid, p_category text, p_title text, p_body text,
  p_module text, p_group_id uuid)
returns void language sql security definer set search_path to 'public' as $function$
  insert into notifications (audience, agent_id, category, title, body, module, group_id)
  values (p_audience, p_agent_id, p_category, p_title, p_body, p_module, p_group_id);
$function$;

drop function if exists public.notification_link(text, text, text, uuid);

-- NOTE: the two reminder generators keep passing their booking id. That is a
-- strict improvement and harmless without the resolver — group_id simply holds
-- a booking id, as the transport senders already did.

commit;
