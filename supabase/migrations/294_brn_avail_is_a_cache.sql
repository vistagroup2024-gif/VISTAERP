-- 294 The hourly availability refresh was being turned away by the group guard.
--
-- refresh_brn_availability() writes umrah_groups.brn_avail — the cached "Ready to
-- Allocate / Waiting BRN" readiness the group list and the calendar read. The
-- cron endpoint that runs it has no Supabase session, so it is never an admin,
-- and guard_group_update refuses any field change on a group whose visa is
-- issued. Its second statement clears the cache on groups that have left
-- 'process', which is exactly where the issued ones are, so the whole function
-- aborted with "only a Super Admin can edit it" and the readiness went stale.
--
-- Measured as the anon role, before this: the call raised. After: it completes.
--
-- brn_avail is a DERIVED CACHE, not group data — recomputed from inventory,
-- carrying no decision anybody made. It belongs in the guard's neutralised list
-- beside total_nights, the other column that is computed rather than entered.
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
      -- brn_avail is the cached readiness, recomputed from inventory by
      -- refresh_brn_availability(). Derived, not entered: nobody's decision is in
      -- it, and the hourly job that keeps it fresh has no session to be an admin.
      n.brn_avail          := old.brn_avail;
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
