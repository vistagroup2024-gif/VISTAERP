-- 040_workflow_decision_hostdetails_reminders.sql
-- Applied via MCP. Highlights:
--  * Admin decision gate: set_group_decision(Process/Payment/Reject); allocation
--    now requires workflow_status = 'process'.
--  * Long Stay visa: host_details jsonb; b2b_create/update handle it; advance
--    lets Long Stay skip BRN allocation (process -> erp_created).
--  * Notification policy: agents only get Payment Required / Rejected (+ hotel
--    reminders); internal stages notify staff only.
--  * Hotel Details reminder engine (48/24/12h agent + 24h admin escalation),
--    Non Masar & Masar only, deduped via hotel_reminder_sent.
-- See the database for the authoritative bodies of: set_group_decision,
-- allocate_group_brns, reallocate_all_brns, reopen_group, advance_workflow,
-- notify_group_events, generate_hotel_reminders, b2b_create_group, b2b_update_group.

alter table umrah_groups add column if not exists host_details jsonb;

create table if not exists hotel_reminder_sent (
  group_id uuid not null,
  audience text not null,
  threshold int not null,
  sent_at timestamptz not null default now(),
  primary key (group_id, audience, threshold)
);

-- set_group_decision: Process / Payment / Reject gate before allocation.
create or replace function set_group_decision(p_group uuid, p_decision text)
 returns void language plpgsql security definer set search_path to 'public'
as $$
declare g umrah_groups%rowtype; v_new text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform set_config('vista.bypass_guard','1',true);
  select * into g from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if p_decision = 'process' then
    if coalesce(g.workflow_status,'pending') not in ('pending','payment_pending') then raise exception 'Process can only be chosen from Pending/Payment Pending'; end if;
    v_new := 'process';
  elsif p_decision = 'payment' then
    if coalesce(g.workflow_status,'pending') <> 'pending' then raise exception 'Payment can only be chosen from Pending'; end if;
    v_new := 'payment_pending';
  elsif p_decision = 'reject' then
    if coalesce(g.workflow_status,'pending') not in ('pending','payment_pending') then raise exception 'Reject can only be chosen from Pending/Payment Pending'; end if;
    v_new := 'rejected';
  else raise exception 'Unknown decision %', p_decision;
  end if;
  update umrah_groups set workflow_status = v_new where id = p_group;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (g.company_id, auth.uid(), 'group_decision_'||p_decision, 'umrah_group', p_group, jsonb_build_object('group_no', g.group_no));
end $$;
grant execute on function set_group_decision(uuid, text) to authenticated;
grant execute on function generate_hotel_reminders() to anon, authenticated;
