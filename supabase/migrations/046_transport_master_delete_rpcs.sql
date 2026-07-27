-- ============================================================
-- VISTA ERP - 046 Transport master delete RPCs
-- Applied to remote DB via Supabase MCP; kept here for history.
-- Staff-guarded, FK-usage checked, audited. Mirrors delete_group_company.
-- Child rows (route rates, package legs) are deleted directly via RLS.
-- ============================================================

create or replace function delete_transport_vehicle(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r transport_vehicles%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into r from transport_vehicles where id = p_id and company_id = auth_company_id();
  if not found then raise exception 'Vehicle not found'; end if;
  if exists (select 1 from transport_route_rates where vehicle_id = p_id)
     or exists (select 1 from transport_trips where vehicle_id = p_id)
     or exists (select 1 from transport_drivers where vehicle_id = p_id) then
    raise exception 'Cannot delete: this vehicle is in use (rates, drivers or trips). Set it Inactive instead.';
  end if;
  delete from transport_vehicles where id = p_id;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (r.company_id, auth.uid(), 'transport_vehicle_deleted', 'transport_vehicles', p_id, jsonb_build_object('name', r.name));
end $$;

create or replace function delete_transport_route(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r transport_routes%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into r from transport_routes where id = p_id and company_id = auth_company_id();
  if not found then raise exception 'Route not found'; end if;
  if exists (select 1 from transport_trips where route_id = p_id)
     or exists (select 1 from transport_package_legs where route_id = p_id) then
    raise exception 'Cannot delete: this route is used by packages or trips. Set it Inactive instead.';
  end if;
  delete from transport_routes where id = p_id;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (r.company_id, auth.uid(), 'transport_route_deleted', 'transport_routes', p_id, jsonb_build_object('name', r.name));
end $$;

create or replace function delete_transport_package(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r transport_packages%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into r from transport_packages where id = p_id and company_id = auth_company_id();
  if not found then raise exception 'Package not found'; end if;
  if exists (select 1 from transport_bookings where package_id = p_id) then
    raise exception 'Cannot delete: this package is used by one or more bookings. Set it Inactive instead.';
  end if;
  delete from transport_packages where id = p_id;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (r.company_id, auth.uid(), 'transport_package_deleted', 'transport_packages', p_id, jsonb_build_object('name', r.name));
end $$;

create or replace function delete_transport_driver(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r transport_drivers%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into r from transport_drivers where id = p_id and company_id = auth_company_id();
  if not found then raise exception 'Driver not found'; end if;
  if exists (select 1 from transport_trips where driver_id = p_id) then
    raise exception 'Cannot delete: this driver is assigned to trips. Set the driver Inactive instead.';
  end if;
  delete from transport_drivers where id = p_id;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (r.company_id, auth.uid(), 'transport_driver_deleted', 'transport_drivers', p_id, jsonb_build_object('name', r.name));
end $$;

revoke all on function delete_transport_vehicle(uuid), delete_transport_route(uuid), delete_transport_package(uuid), delete_transport_driver(uuid) from anon, public;
grant execute on function delete_transport_vehicle(uuid), delete_transport_route(uuid), delete_transport_package(uuid), delete_transport_driver(uuid) to authenticated;
