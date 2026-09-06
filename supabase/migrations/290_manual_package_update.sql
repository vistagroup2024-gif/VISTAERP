-- 290 Marking a package updated by hand.
--
-- The package-update flow assumes the hotel gets sorted out first: allocate BRNs
-- until the stay is covered, and only then is the package marked updated in
-- Nusuk. Sometimes it goes the other way round — the package is updated at the
-- Nusuk end without this system's inventory being the thing that covers it — and
-- there was no way to say so. The group sat in Pending Updates for ever.
--
-- Marking it by hand does exactly one thing: it moves the status. It allocates
-- nothing, consumes no BRN and touches no inventory.

-- ── History records how it was marked ───────────────────────────────────────
alter table package_update_history
  add column if not exists manual boolean not null default false;

comment on column package_update_history.manual is
  'true when a person marked the package updated by hand, without the stay being covered by allocated BRNs.';

-- ── An issued visa must not block the package update ────────────────────────
-- The guard stops a group being edited once its visa is issued. But the package
-- update HAPPENS after issuance — that is the whole point of the flow — and
-- package_status is workflow state, not group data, so it belongs in the same
-- list as arrival service and invoice tracking: fields a staff user may still
-- move on an issued group. Without this every group in Pending Updates is
-- admin-only, and both Mark Updated buttons fail with "only a Super Admin can
-- edit it" — which is what they did.
--
-- Everything else stays locked: dates, pax, agent, visa status, and the coverage
-- columns the allocation routines write.
create or replace function public.guard_group_update()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare n umrah_groups := new;
begin
  if old.visa_status = 'issued' then
    if new.visa_status = 'issued' and not has_role('admin') then
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
end $fn$;

-- ── A hand-marked package stays marked ──────────────────────────────────────
-- recompute_group_coverage already keeps 'updated' when the stay IS covered. It
-- did not when the stay is not — which is precisely the case a hand-marked group
-- is in, so the next allocation change on that group would silently put it back
-- in Pending Updates and undo a person's decision. Both branches keep it now.
create or replace function public.recompute_group_coverage(p_group uuid, p_mode text default 'update')
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare grp umrah_groups%rowtype; cf date; ct date; covered boolean; v_status text;
begin
  perform set_config('vista.bypass_guard', '1', true);
  perform merge_adjacent_group_brns(p_group);
  select * into grp from umrah_groups where id = p_group;
  if not exists (select 1 from group_brn_allocation where group_id = p_group) then
    update umrah_groups set brn_status = 'pending', package_status = null, covered_from = null, covered_to = null where id = p_group;
    return;
  end if;
  select min(c.check_in), max(c.check_out) into cf, ct
  from group_brn_allocation ga join brn_consumption c on c.id = ga.consumption_id where ga.group_id = p_group;
  covered := nusuk_complete(p_group);
  if not covered then v_status := case when grp.package_status = 'updated' then 'updated' else 'update_required' end;
  elsif p_mode = 'fresh' then v_status := 'complete';
  else v_status := case when grp.package_status = 'updated' then 'updated' else 'update_ready' end;
  end if;
  update umrah_groups set brn_status = 'allocated', covered_from = cf, covered_to = ct, package_status = v_status where id = p_group;
end $fn$;

-- ── The action itself ───────────────────────────────────────────────────────
-- Deliberately NOT a variant of mark_package_updated(): that one is the end of
-- the allocation flow and checks nusuk_complete() before it will move anything.
-- This one is the override, and the whole point of it is that the check does not
-- apply — so it is its own routine, recorded as its own thing, rather than a
-- flag that quietly turns the check off in the routine everyone else uses.
create or replace function public.mark_package_updated_manual(p_group uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare g umrah_groups%rowtype; v_prev text; v_comp text; v_agent text; v_name text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform set_config('vista.bypass_guard', '1', true);

  select * into g from umrah_groups where id = p_group and company_id = auth_company_id();
  if not found then raise exception 'Group not found'; end if;
  if g.package_status = 'updated' then
    raise exception 'This package is already marked updated.';
  end if;
  -- Only a group the package-update flow is actually waiting on. This is an
  -- override for that queue, not a way to stamp 'updated' on any group at all.
  if g.package_status is null or g.package_status not in ('update_required', 'update_available', 'update_ready') then
    raise exception 'This group is not waiting for a package update.';
  end if;

  -- Whatever it is covered by today, for the record. Nothing is allocated here.
  select string_agg(distinct i.brn || ' (' || to_char(c.check_in, 'DD Mon') || '→' || to_char(c.check_out, 'DD Mon') || ')', ', ')
    into v_prev
    from group_brn_allocation ga
    join brn_consumption c on c.id = ga.consumption_id
    join brn_inventory i on i.id = ga.brn_id
   where ga.group_id = p_group;
  select name into v_comp from group_companies where id = g.group_company_id;
  select name into v_agent from parties where id = g.agent_id;
  select email into v_name from auth.users where id = auth.uid();

  update umrah_groups set package_status = 'updated' where id = p_group;

  insert into package_update_history(company_id, group_id, group_no, company_name, agent_name,
                                     arrival_date, departure_date, prev_brns, new_brns,
                                     updated_by, updated_by_name, manual)
  values (g.company_id, p_group, g.group_no, v_comp, v_agent, g.arrival_date, g.departure_date,
          coalesce(v_prev, '—'), 'Marked updated manually — no BRN allocated',
          auth.uid(), v_name, true);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (g.company_id, auth.uid(), 'package_updated_manual', 'umrah_group', p_group,
          jsonb_build_object('group_no', g.group_no, 'from', g.package_status));
end $fn$;

revoke all on function public.mark_package_updated_manual(uuid) from anon;
grant execute on function public.mark_package_updated_manual(uuid) to authenticated;
