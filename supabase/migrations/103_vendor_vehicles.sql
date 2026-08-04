-- ============================================================
-- VISTA ERP - 103 Vendor vehicle capability
-- transport_vendors.vehicle_ids lists the vehicles a vendor operates. A vendor-
-- driver operates a single vehicle; a supplier vendor may operate several (the
-- UI enforces single vs multiple). When a vendor has any vehicles configured,
-- transport_assign_vendor rejects assigning them to a trip whose vehicle is not
-- one of theirs (e.g. a GMC trip to a Starex-only driver). Empty = unrestricted.
-- (Applied to remote DB via Supabase MCP; kept here for history.)
-- ============================================================
alter table transport_vendors add column if not exists vehicle_ids uuid[] not null default '{}';

create or replace function public.transport_assign_vendor(
  p_trip uuid, p_vendor uuid, p_driver_name text default null,
  p_driver_mobile text default null, p_vendor_cost numeric default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v transport_vendors%rowtype; t transport_trips%rowtype; v_name text; v_mobile text; v_veh uuid; v_veh_name text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into v from transport_vendors where id = p_vendor and company_id = auth_company_id();
  if not found then raise exception 'Vendor not found'; end if;
  select * into t from transport_trips where id = p_trip and company_id = auth_company_id();
  if not found then raise exception 'Trip not found'; end if;

  v_veh := coalesce(t.vehicle_id, t.requested_vehicle_id);
  if array_length(v.vehicle_ids, 1) is not null and v_veh is not null and not (v_veh = any(v.vehicle_ids)) then
    select name into v_veh_name from transport_vehicles where id = v_veh;
    raise exception 'Vendor % does not operate %.', v.name, coalesce(v_veh_name, 'this vehicle');
  end if;

  if v.vendor_type = 'vendor_driver' then
    v_name := coalesce(nullif(v.contact_person,''), v.name);
    v_mobile := v.mobile;
  else
    v_name := nullif(p_driver_name,'');
    v_mobile := nullif(p_driver_mobile,'');
  end if;
  update transport_trips set vendor_id = p_vendor, outsource_driver_name = v_name,
    outsource_driver_mobile = v_mobile, vendor_cost = p_vendor_cost, status = 'outsourced', assigned_at = now(),
    driver_id = null, scheduled_start = null, scheduled_end = null, is_upgraded = false
  where id = p_trip and company_id = auth_company_id()
    and status in ('pending','outsource_required','outsourced','assigned','on_route');
  if not found then raise exception 'Trip not found or cannot be outsourced in its current status.'; end if;
end $function$;
