-- ============================================================
-- VISTA ERP - 020 Delete linked bill with BRN + master deletes
-- - Deleting a BRN now also removes its linked AP bill and reverses
--   the bill's GL journal entry (previously the bill was left behind).
-- - Adds delete_party and delete_service with reference guards.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================

create or replace function delete_brn_bill(p_brn brn_inventory)
returns void language plpgsql security definer set search_path = public as $$
declare b bills%rowtype;
begin
  if p_brn.bill_id is null then return; end if;
  select * into b from bills where id = p_brn.bill_id;
  if not found then return; end if;
  delete from journal_entries where company_id = b.company_id and source = 'bill' and reference = b.bill_no;
  delete from bills where id = b.id;   -- bill_lines cascade; payments.bill_id set null
end $$;
revoke all on function delete_brn_bill(brn_inventory) from anon, public;

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
  perform delete_brn_bill(v_brn);
  delete from brn_inventory where id = p_brn;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_brn.company_id, auth.uid(), 'brn_deleted', 'brn_inventory', p_brn,
          jsonb_build_object('brn', v_brn.brn, 'hotel', v_brn.hotel_name, 'bill_removed', v_brn.bill_id is not null));
end $$;

create or replace function admin_delete_brn(p_brn uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_brn brn_inventory%rowtype; v_groups text;
begin
  if not has_role('admin') then raise exception 'Only a Super Admin can force-delete a BRN'; end if;
  select * into v_brn from brn_inventory where id = p_brn;
  if not found then raise exception 'BRN not found'; end if;
  select string_agg(distinct g.group_no, ', ') into v_groups
  from group_brn_allocation a join umrah_groups g on g.id = a.group_id where a.brn_id = p_brn;
  delete from brn_consumption where brn_id = p_brn;
  delete from group_brn_allocation where brn_id = p_brn;
  update umrah_groups g set brn_status = 'pending'
   where g.brn_status = 'allocated'
     and not exists (select 1 from group_brn_allocation a where a.group_id = g.id);
  perform delete_brn_bill(v_brn);
  delete from brn_inventory where id = p_brn;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_brn.company_id, auth.uid(), 'brn_force_deleted', 'brn_inventory', p_brn,
          jsonb_build_object('brn', v_brn.brn, 'hotel', v_brn.hotel_name,
                             'affected_groups', coalesce(v_groups,''), 'bill_removed', v_brn.bill_id is not null,
                             'reason', coalesce(p_reason,'')));
end $$;

create or replace function delete_party(p_party uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p parties%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into p from parties where id = p_party;
  if not found then raise exception 'Party not found'; end if;
  if exists (select 1 from bookings where customer_id = p_party)
     or exists (select 1 from invoices where customer_id = p_party)
     or exists (select 1 from bills where supplier_id = p_party)
     or exists (select 1 from umrah_groups where agent_id = p_party)
     or exists (select 1 from brn_inventory where supplier_id = p_party)
     or exists (select 1 from customer_rates where party_id = p_party) then
    raise exception 'Cannot delete: this customer/agent/supplier is used by orders, invoices, bills, groups, BRNs or rate cards.';
  end if;
  delete from parties where id = p_party;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (p.company_id, auth.uid(), 'party_deleted', 'parties', p_party, jsonb_build_object('name', p.name));
end $$;

create or replace function delete_service(p_service uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s service_catalog%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into s from service_catalog where id = p_service;
  if not found then raise exception 'Service not found'; end if;
  if exists (select 1 from booking_items where service_id = p_service)
     or exists (select 1 from customer_rates where service_id = p_service) then
    raise exception 'Cannot delete: this service is used by orders or per-customer rates. Deactivate it instead.';
  end if;
  delete from service_catalog where id = p_service;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (s.company_id, auth.uid(), 'service_deleted', 'service_catalog', p_service, jsonb_build_object('name', s.name));
end $$;

revoke all on function delete_party(uuid) from anon, public;
revoke all on function delete_service(uuid) from anon, public;
grant execute on function delete_party(uuid) to authenticated;
grant execute on function delete_service(uuid) to authenticated;
