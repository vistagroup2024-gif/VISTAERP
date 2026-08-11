-- 162 Allow arrival-service edits on an issued group.
--
-- guard_group_update() (migration 018) blocks EVERY non-admin edit to a group whose
-- visa is issued. But the Arrival Service (Transport booking / Tafweej) is handled
-- AFTER the visa is issued, so transport staff must be able to set arrival_service
-- and mark Tafweej on an issued group. This exempts arrival-service-only changes;
-- any other field change on an issued group is still blocked for non-admins.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

create or replace function guard_group_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare n umrah_groups := new;
begin
  if old.visa_status = 'issued' then
    if new.visa_status = 'issued' and not has_role('admin') then
      -- Neutralise the arrival-service fields, then compare: if nothing ELSE changed,
      -- this is an arrival-service-only edit and is allowed post-issuance.
      n.arrival_service    := old.arrival_service;
      n.arrival_tafweej_at := old.arrival_tafweej_at;
      n.arrival_tafweej_by := old.arrival_tafweej_by;
      if n is distinct from old then
        raise exception 'This group has an issued visa — only a Super Admin can edit it.';
      end if;
    end if;
    if has_role('admin') and (new is distinct from old) then
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (old.company_id, auth.uid(), 'group_override_edit', 'umrah_group', old.id,
              jsonb_build_object('group_no', old.group_no));
    end if;
  end if;
  return new;
end $$;
