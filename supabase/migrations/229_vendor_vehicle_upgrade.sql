-- 229_vendor_vehicle_upgrade.sql
-- Outsourcing to a vendor now follows the same vehicle-rank UPGRADE ladder as the
-- in-house fleet. Previously transport_assign_vendor required the vendor to
-- operate the EXACT booked vehicle and always set is_upgraded = false — so a
-- vendor with a higher-category vehicle (a valid upgrade) was rejected on assign
-- even though the picker offered it.
--
-- New rule: a vendor may serve the trip if it operates a vehicle whose
-- upgrade_rank is >= the booked vehicle's. The served vehicle is the exact one if
-- the vendor operates it, otherwise the smallest-rank vehicle the vendor operates
-- that still meets the requirement (the minimal upgrade). The trip's served
-- vehicle and is_upgraded flag are set accordingly, exactly like an in-house
-- upgrade — the customer fare (sell_rate) is unchanged.
create or replace function transport_assign_vendor(
  p_trip uuid, p_vendor uuid, p_driver_name text default null, p_driver_mobile text default null, p_vendor_cost numeric default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v transport_vendors%rowtype; t transport_trips%rowtype;
  v_name text; v_mobile text; v_req uuid; v_reqrank int; v_best uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into v from transport_vendors where id = p_vendor and company_id = auth_company_id();
  if not found then raise exception 'Vendor not found'; end if;
  select * into t from transport_trips where id = p_trip and company_id = auth_company_id();
  if not found then raise exception 'Trip not found'; end if;

  v_req := coalesce(t.requested_vehicle_id, t.vehicle_id);
  v_reqrank := coalesce((select upgrade_rank from transport_vehicles where id = v_req), 0);

  -- Pick the vehicle the vendor will serve with (same upgrade ladder as own fleet).
  if v.vehicle_ids is null or array_length(v.vehicle_ids, 1) is null then
    v_best := v_req;                                   -- vendor unconstrained
  elsif v_req is not null and v_req = any(v.vehicle_ids) then
    v_best := v_req;                                   -- exact match, no upgrade
  else
    select ve.id into v_best from transport_vehicles ve
      where ve.id = any(v.vehicle_ids) and coalesce(ve.upgrade_rank, 0) >= v_reqrank
      order by coalesce(ve.upgrade_rank, 0) asc, ve.name limit 1;
    if v_best is null then
      raise exception 'Vendor % does not operate a vehicle of the required category or higher.', v.name;
    end if;
  end if;

  if v.vendor_type = 'vendor_driver' then v_name := coalesce(nullif(v.contact_person,''), v.name); v_mobile := v.mobile;
  else v_name := nullif(p_driver_name,''); v_mobile := nullif(p_driver_mobile,''); end if;

  update transport_trips set vendor_id = p_vendor, outsource_driver_name = v_name,
    outsource_driver_mobile = v_mobile, vendor_cost = p_vendor_cost, status = 'assigned', assigned_at = now(),
    driver_id = null, scheduled_start = null, scheduled_end = null,
    requested_vehicle_id = coalesce(requested_vehicle_id, vehicle_id),
    vehicle_id = coalesce(v_best, vehicle_id),
    is_upgraded = (v_best is distinct from v_req)
  where id = p_trip and company_id = auth_company_id()
    and status in ('pending','outsource_required','outsourced','assigned','on_route');
  if not found then raise exception 'Trip not found or cannot be outsourced in its current status.'; end if;
end $function$;
