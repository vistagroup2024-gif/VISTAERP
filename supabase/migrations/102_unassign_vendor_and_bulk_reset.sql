-- ============================================================
-- VISTA ERP - 102 Universal unassign + bulk reset assignments
-- transport_unassign_trip now clears BOTH the in-house driver and any outsourced
-- vendor (previously only the driver), so vendors can be unassigned from the
-- operations action menu. transport_reset_assignments unassigns every still-active
-- trip (optionally for one day) back to Pending; completed/cancelled are left as-is.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================
create or replace function public.transport_unassign_trip(p_trip uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update transport_trips set
    driver_id = null, vendor_id = null, vendor_cost = null,
    outsource_driver_name = null, outsource_driver_mobile = null, is_outsourced = false,
    status = 'pending', scheduled_start = null, scheduled_end = null, assigned_at = null,
    vehicle_id = coalesce(requested_vehicle_id, vehicle_id), is_upgraded = false
  where id = p_trip and company_id = auth_company_id();
  if not found then raise exception 'Trip not found'; end if;
end $function$;

create or replace function public.transport_reset_assignments(p_date date default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_count int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  with upd as (
    update transport_trips set
      driver_id = null, vendor_id = null, vendor_cost = null,
      outsource_driver_name = null, outsource_driver_mobile = null, is_outsourced = false,
      status = 'pending', scheduled_start = null, scheduled_end = null, assigned_at = null,
      vehicle_id = coalesce(requested_vehicle_id, vehicle_id), is_upgraded = false
    where company_id = auth_company_id()
      and status in ('assigned','on_route','picked_up','outsourced','outsource_required')
      and (p_date is null or trip_date = p_date)
    returning 1
  ) select count(*) into v_count from upd;
  return v_count;
end $function$;
revoke all on function public.transport_reset_assignments(date) from anon, public;
