-- 041_attachments_and_delete_release.sql  (applied via MCP)
-- * group_attachments: in-DB (base64) files for a Visa Group, JPG/PNG/PDF,
--   multiple, accessed only through SECURITY DEFINER RPCs. Agents may add/delete
--   only while the group is 'pending' (unlocked); staff always.
-- * delete_group: any non-issued group can be deleted; BRN allocations and
--   held reservations are released automatically. Attachments cascade.
-- Authoritative function bodies live in the database. RPCs:
--   attachment_add/list/get/delete (staff),
--   b2b_attachment_add/list/get/delete (agent token).

create table if not exists group_attachments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references umrah_groups(id) on delete cascade,
  name text not null,
  mime text,
  size int,
  data text not null,          -- base64
  uploaded_by text,
  source text,                 -- 'staff' | 'agent'
  created_at timestamptz not null default now()
);
create index if not exists idx_group_attachments_group on group_attachments (group_id);
alter table group_attachments enable row level security;

-- delete_group now releases allocations + reservations for any non-issued group.
create or replace function delete_group(p_group uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare g umrah_groups%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into g from umrah_groups where id = p_group;
  if not found then raise exception 'Group not found'; end if;
  if g.visa_status = 'issued' or coalesce(g.workflow_status,'pending') = 'visa_issued' then
    raise exception 'Cannot delete: visa already issued.';
  end if;
  perform set_config('vista.bypass_guard','1',true);
  delete from brn_consumption where id in (
    select consumption_id from group_brn_allocation where group_id = p_group and consumption_id is not null);
  delete from group_brn_allocation where group_id = p_group;
  delete from company_reservations where group_id = p_group;
  delete from hotel_reminder_sent where group_id = p_group;
  delete from umrah_groups where id = p_group;   -- attachments cascade
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (g.company_id, auth.uid(), 'group_deleted', 'umrah_group', p_group, jsonb_build_object('group_no', g.group_no));
end $function$;
