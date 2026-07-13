-- ============================================================
-- VISTA ERP - 018 CRUD guards + role-based permissions
-- - delete_brn: blocked if inventory consumed
-- - delete_group: blocked if BRNs allocated or visa issued
-- - admin_delete_group: Super Admin force-delete (audited, releases beds)
-- - triggers: block structural BRN edits after consumption and group edits
--   after visa issued for non-admins; admin overrides audited
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

create or replace function delete_brn(p_brn uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_brn brn_inventory%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into v_brn from brn_inventory where id = p_brn;
  if not found then raise exception 'BRN not found'; end if;
  if exists (select 1 from brn_consumption where brn_id = p_brn) then
    raise exception 'Cannot delete: this BRN has consumed inventory / active group allocations. Release those allocations first.';
  end if;
  delete from brn_inventory where id = p_brn;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_brn.company_id, auth.uid(), 'brn_deleted', 'brn_inventory', p_brn,
          jsonb_build_object('brn', v_brn.brn, 'hotel', v_brn.hotel_name));
end $$;

create or replace function delete_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g umrah_groups%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into g from umrah_groups where id = p_group;
  if not found then raise exception 'Group not found'; end if;
  if g.visa_status = 'issued' then
    raise exception 'Cannot delete: visa already issued. Only a Super Admin can reopen/cancel this group.';
  end if;
  if g.brn_status = 'allocated' then
    raise exception 'Cannot delete: BRNs are allocated. Release the allocation first (Super Admin can reopen).';
  end if;
  delete from umrah_groups where id = p_group;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (g.company_id, auth.uid(), 'group_deleted', 'umrah_group', p_group,
          jsonb_build_object('group_no', g.group_no));
end $$;

create or replace function admin_delete_group(p_group uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare g umrah_groups%rowtype;
begin
  if not has_role('admin') then raise exception 'Only a Super Admin can force-delete'; end if;
  select * into g from umrah_groups where id = p_group;
  if not found then raise exception 'Group not found'; end if;
  delete from brn_consumption where id in (
    select consumption_id from group_brn_allocation where group_id = p_group and consumption_id is not null);
  delete from umrah_groups where id = p_group;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (g.company_id, auth.uid(), 'group_force_deleted', 'umrah_group', p_group,
          jsonb_build_object('group_no', g.group_no, 'reason', coalesce(p_reason,'')));
end $$;

revoke all on function delete_brn(uuid) from anon, public;
revoke all on function delete_group(uuid) from anon, public;
revoke all on function admin_delete_group(uuid, text) from anon, public;
grant execute on function delete_brn(uuid) to authenticated;
grant execute on function delete_group(uuid) to authenticated;
grant execute on function admin_delete_group(uuid, text) to authenticated;

-- Structural BRN edits blocked after consumption (admin override audited)
create or replace function guard_brn_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare structural_changed boolean;
begin
  structural_changed := (new.check_in <> old.check_in or new.check_out <> old.check_out
                         or new.beds <> old.beds or coalesce(new.city,'') <> coalesce(old.city,''));
  if structural_changed and exists (select 1 from brn_consumption where brn_id = old.id) then
    if not has_role('admin') then
      raise exception 'This BRN has consumed inventory — only a Super Admin can change its dates, beds, or city.';
    end if;
    insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
    values (old.company_id, auth.uid(), 'brn_override_edit', 'brn_inventory', old.id,
            jsonb_build_object('brn', old.brn));
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_brn_update on brn_inventory;
create trigger trg_guard_brn_update before update on brn_inventory
  for each row execute function guard_brn_update();

-- Group edits blocked after visa issued for non-admins (admin override audited)
create or replace function guard_group_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.visa_status = 'issued' then
    if new.visa_status = 'issued' and not has_role('admin') then
      raise exception 'This group has an issued visa — only a Super Admin can edit it.';
    end if;
    if has_role('admin') and (new is distinct from old) then
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (old.company_id, auth.uid(), 'group_override_edit', 'umrah_group', old.id,
              jsonb_build_object('group_no', old.group_no));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_group_update on umrah_groups;
create trigger trg_guard_group_update before update on umrah_groups
  for each row execute function guard_group_update();
