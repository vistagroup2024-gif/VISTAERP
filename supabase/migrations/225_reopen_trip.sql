-- 225_reopen_trip.sql
-- Reopen a single cancelled trip inside a booking.
--
-- Pairs with transport_cancel_trip (item: per-trip cancel). Once any trip in a
-- multi-trip booking is completed, the whole booking can no longer be cancelled
-- (enforced in the UI) — trips are cancelled/reopened individually here.
--
-- A reopened trip is priced at the AGENT'S SINGLE-ROUTE fare (not the package
-- price): cancelling a package trip already converts the booking to 'multiple'
-- and re-prices every leg at individual rates, so a reopened leg follows the same
-- single-route pricing. The booking totals are recomputed from the surviving
-- (non-cancelled) trips.
create or replace function transport_reopen_trip(p_trip uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_company uuid := auth_company_id();
  t transport_trips%rowtype; b transport_bookings%rowtype;
  v_rate numeric; v_sell numeric := 0; v_extra numeric := 0; v_disc numeric; v_net numeric;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into t from transport_trips where id = p_trip and company_id = v_company;
  if not found then raise exception 'Trip not found'; end if;
  if t.status <> 'cancelled' then raise exception 'Only a cancelled trip can be reopened.'; end if;
  select * into b from transport_bookings where id = t.booking_id and company_id = v_company;

  -- Single-route agent fare for this leg (fallback to its stored normal/sell rate).
  v_rate := coalesce(
    transport_agent_rate(v_company, b.agent_id, t.route_id, coalesce(t.requested_vehicle_id, t.vehicle_id), b.booking_date),
    nullif(t.normal_rate, 0), t.sell_rate, 0);

  update transport_trips set
    status = 'pending', cancelled_with_booking = false,
    driver_id = null, vendor_id = null, scheduled_start = null, scheduled_end = null, assigned_at = null,
    sell_rate = v_rate, normal_rate = v_rate
  where id = p_trip;

  -- A cancelled booking becomes active again once a trip is reopened.
  if b.status = 'cancelled' then
    update transport_bookings set status = 'confirmed' where id = b.id;
  end if;

  -- Recompute booking totals from the surviving (non-cancelled) trips.
  select coalesce(sum(sell_rate),0), coalesce(sum(case when hajj_terminal then extra_charge else 0 end),0)
    into v_sell, v_extra
  from transport_trips where booking_id = b.id and status <> 'cancelled';
  v_disc := least(greatest(coalesce(b.discount,0),0), v_sell);
  v_net := v_sell - v_disc;
  update transport_bookings set sell_amount = v_sell, discount = v_disc,
    additional_charges = v_extra, net_amount = v_net, total_amount = v_net + v_extra, updated_at = now()
  where id = b.id;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'transport_trip_reopened', 'transport_bookings', b.id,
    jsonb_build_object('trip', p_trip));
end $function$;

grant execute on function transport_reopen_trip(uuid) to authenticated;
