-- ============================================================
-- VISTA ERP - 019 Super Admin force-delete BRN
-- Allows a Super Admin to delete a BRN even when consumed:
-- releases all its consumption + allocations, reverts affected
-- groups to 'pending', and records the action in the audit log.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

create or replace function admin_delete_brn(p_brn uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_brn brn_inventory%rowtype; v_groups text;
begin
  if not has_role('admin') then raise exception 'Only a Super Admin can force-delete a BRN'; end if;
  select * into v_brn from brn_inventory where id = p_brn;
  if not found then raise exception 'BRN not found'; end if;

  select string_agg(distinct g.group_no, ', ')
    into v_groups
  from group_brn_allocation a join umrah_groups g on g.id = a.group_id
  where a.brn_id = p_brn;

  delete from brn_consumption where brn_id = p_brn;
  delete from group_brn_allocation where brn_id = p_brn;
  update umrah_groups g set brn_status = 'pending'
   where g.brn_status = 'allocated'
     and not exists (select 1 from group_brn_allocation a where a.group_id = g.id);
  delete from brn_inventory where id = p_brn;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_brn.company_id, auth.uid(), 'brn_force_deleted', 'brn_inventory', p_brn,
          jsonb_build_object('brn', v_brn.brn, 'hotel', v_brn.hotel_name,
                             'affected_groups', coalesce(v_groups,''), 'reason', coalesce(p_reason,'')));
end $$;

revoke all on function admin_delete_brn(uuid, text) from anon, public;
grant execute on function admin_delete_brn(uuid, text) to authenticated;
