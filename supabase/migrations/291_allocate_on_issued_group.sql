-- 291 Re-allocating a hotel on a group whose visa is already issued.
--
-- 290 let staff move package_status on an issued group, because the package
-- update happens after issuance and the status is workflow state, not group
-- data. The allocation itself was still admin-only: the routines write
-- brn_status, covered_from and covered_to, and guard_group_update turned any
-- non-admin away with "only a Super Admin can edit it". So a staff user could
-- say the package was updated but could not do the update.
--
-- Those three columns are now open too — but not to every staff user the way
-- package_status is. Re-allocating a hotel on an issued group moves real
-- inventory on a group that is already sold, so it needs
-- `visa.allocate_issued`, read through staff_perm_strict(): the key must be
-- ticked explicitly, and unlike every other setting in the system an empty
-- permissions map does NOT grant it.
--
-- Everything else stays exactly as locked as it was: dates, pax, agent, visa
-- status. And every such change is written to the audit log, the same way an
-- admin's override edit already is.
create or replace function public.guard_group_update()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare n umrah_groups := new; v_touch boolean; v_may boolean := false;
begin
  if old.visa_status = 'issued' then
    if new.visa_status = 'issued' and not has_role('admin') then
      -- Is this edit moving the hotel allocation, and may this user do that?
      v_touch := (new.brn_status, new.covered_from, new.covered_to)
                 is distinct from (old.brn_status, old.covered_from, old.covered_to);
      if v_touch then v_may := staff_perm_strict('visa.allocate_issued'); end if;

      -- Arrival service, invoice tracking and the package update all happen
      -- AFTER issuance; allow staff to change only those fields on an issued
      -- group. Any other change stays blocked.
      n.arrival_service    := old.arrival_service;
      n.arrival_tafweej_at := old.arrival_tafweej_at;
      n.arrival_tafweej_by := old.arrival_tafweej_by;
      n.invoice_created    := old.invoice_created;
      n.invoice_created_at := old.invoice_created_at;
      n.invoice_created_by := old.invoice_created_by;
      n.package_status     := old.package_status;
      -- total_nights is a GENERATED STORED column; NEW holds NULL for it inside a
      -- BEFORE trigger, so it would always differ from OLD. Neutralise it too.
      n.total_nights       := old.total_nights;
      if v_may then
        n.brn_status   := old.brn_status;
        n.covered_from := old.covered_from;
        n.covered_to   := old.covered_to;
      end if;

      if n is distinct from old then
        -- Say which of the two walls they hit, or they cannot tell whether to
        -- ask for a permission or for an admin.
        if v_touch and not v_may then
          raise exception 'This group has an issued visa — changing its hotel allocation needs the "Allocate BRNs after visa issued" permission.';
        end if;
        raise exception 'This group has an issued visa — only a Super Admin can edit it.';
      end if;

      if v_may then
        insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (old.company_id, auth.uid(), 'group_issued_coverage_edit', 'umrah_group', old.id,
                jsonb_build_object('group_no', old.group_no,
                  'from', jsonb_build_object('brn_status', old.brn_status, 'covered_from', old.covered_from, 'covered_to', old.covered_to),
                  'to',   jsonb_build_object('brn_status', new.brn_status, 'covered_from', new.covered_from, 'covered_to', new.covered_to)));
      end if;
    end if;
    if has_role('admin') and (new is distinct from old) then
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (old.company_id, auth.uid(), 'group_override_edit', 'umrah_group', old.id,
              jsonb_build_object('group_no', old.group_no));
    end if;
  end if;
  return new;
end $fn$;
