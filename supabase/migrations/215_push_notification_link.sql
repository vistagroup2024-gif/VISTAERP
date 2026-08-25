-- 8-arg push_notification overload carrying a deep-link; accounting approval
-- notifications now deep-link to /accounting/approvals. Mirror of applied migration.
create or replace function push_notification(
  p_audience text, p_agent_id uuid, p_category text, p_title text, p_body text,
  p_module text, p_group_id uuid, p_link text)
 returns void language sql security definer set search_path to 'public'
as $$
  insert into notifications (audience, agent_id, category, title, body, module, group_id, link)
  values (p_audience, p_agent_id, p_category, p_title, p_body, p_module, p_group_id, p_link);
$$;
grant execute on function push_notification(text,uuid,text,text,text,text,uuid,text) to authenticated, anon;
-- gl_submit redefined to pass '/accounting/approvals' as the link (see applied migration).
