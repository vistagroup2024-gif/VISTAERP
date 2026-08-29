-- 227_reopen_restore_package.sql
-- Package booking: cancelling a trip converts it to a 'multiple' booking priced at
-- the agent's single-route fares. If EVERY trip is later reopened (no trip left
-- cancelled), the booking should return to the ORIGINAL package and its package
-- rate distribution.
--
-- To do that we must remember which package it was, since the conversion nulls
-- package_id. Store it in orig_package_id on conversion; clear it on restore.

alter table transport_bookings add column if not exists orig_package_id uuid;

-- ---------------------------------------------------------------------------
-- Cancel one trip: keep the existing behaviour, but remember the original package
-- so a full reopen can restore package pricing.
-- ---------------------------------------------------------------------------
create or replace function transport_cancel_trip(p_trip uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_company uuid := auth_company_id();
  t transport_trips%rowtype; b transport_bookings%rowtype;
  v_sell numeric := 0; v_extra numeric := 0; v_disc numeric; v_net numeric; v_left int;
  r record;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into t from transport_trips where id = p_trip and company_id = v_company;
  if not found then raise exception 'Trip not found'; end if;
  if t.status = 'completed' then raise exception 'A completed trip cannot be cancelled.'; end if;
  select * into b from transport_bookings where id = t.booking_id and company_id = v_company;

  update transport_trips set status = 'cancelled', driver_id = null, vendor_id = null,
    scheduled_start = null, scheduled_end = null, assigned_at = null, cancelled_with_booking = false
  where id = p_trip;

  select count(*) into v_left from transport_trips
  where booking_id = b.id and status <> 'cancelled';

  -- Package -> multiple conversion + re-price of the surviving legs.
  if b.booking_type = 'package' and v_left > 0 then
    for r in select * from transport_trips where booking_id = b.id and status <> 'cancelled' loop
      update transport_trips set
        sell_rate = coalesce(
          transport_agent_rate(v_company, b.agent_id, r.route_id, coalesce(r.requested_vehicle_id, r.vehicle_id), b.booking_date),
          nullif(r.normal_rate, 0), r.sell_rate, 0),
        normal_rate = coalesce(
          transport_agent_rate(v_company, b.agent_id, r.route_id, coalesce(r.requested_vehicle_id, r.vehicle_id), b.booking_date),
          nullif(r.normal_rate, 0), r.sell_rate, 0)
      where id = r.id;
    end loop;
    -- Remember the package so a full reopen can restore package rates.
    update transport_bookings set booking_type = 'multiple',
      orig_package_id = coalesce(orig_package_id, package_id), package_id = null
    where id = b.id;
  end if;

  -- Recompute booking totals from the surviving trips.
  select coalesce(sum(sell_rate),0), coalesce(sum(case when hajj_terminal then extra_charge else 0 end),0)
    into v_sell, v_extra
  from transport_trips where booking_id = b.id and status <> 'cancelled';
  v_disc := least(greatest(coalesce(b.discount,0),0), v_sell);
  v_net := v_sell - v_disc;
  update transport_bookings set sell_amount = v_sell, discount = v_disc,
    additional_charges = v_extra, net_amount = v_net, total_amount = v_net + v_extra, updated_at = now()
  where id = b.id;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'transport_trip_cancelled', 'transport_bookings', b.id,
    jsonb_build_object('trip', p_trip, 'repriced_to_multiple', b.booking_type = 'package'));
end $function$;

-- ---------------------------------------------------------------------------
-- Reopen one cancelled trip. If, after reopening, NO trip is left cancelled and
-- the booking came from a package (orig_package_id), restore the package type and
-- its package-rate distribution. Otherwise keep single-route (multiple) pricing.
-- ---------------------------------------------------------------------------
create or replace function transport_reopen_trip(p_trip uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_company uuid := auth_company_id();
  t transport_trips%rowtype; b transport_bookings%rowtype;
  v_rate numeric; v_sell numeric := 0; v_extra numeric := 0; v_disc numeric; v_net numeric;
  v_cancelled int; v_veh uuid; v_price numeric; v_restored boolean := false;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into t from transport_trips where id = p_trip and company_id = v_company;
  if not found then raise exception 'Trip not found'; end if;
  if t.status <> 'cancelled' then raise exception 'Only a cancelled trip can be reopened.'; end if;
  select * into b from transport_bookings where id = t.booking_id and company_id = v_company;

  -- Restore this leg at the agent's single-route fare.
  v_rate := coalesce(
    transport_agent_rate(v_company, b.agent_id, t.route_id, coalesce(t.requested_vehicle_id, t.vehicle_id), b.booking_date),
    nullif(t.normal_rate, 0), t.sell_rate, 0);
  update transport_trips set
    status = 'pending', cancelled_with_booking = false,
    driver_id = null, vendor_id = null, scheduled_start = null, scheduled_end = null, assigned_at = null,
    sell_rate = v_rate, normal_rate = v_rate
  where id = p_trip;

  if b.status = 'cancelled' then
    update transport_bookings set status = 'confirmed' where id = b.id;
  end if;

  -- All trips active again + came from a package → restore package rates.
  select count(*) into v_cancelled from transport_trips where booking_id = b.id and status = 'cancelled';
  if v_cancelled = 0 and b.orig_package_id is not null then
    select requested_vehicle_id into v_veh from transport_trips
      where booking_id = b.id and not coalesce(is_extra,false) and requested_vehicle_id is not null
      order by seq limit 1;
    v_price := transport_package_price(v_company, b.agent_id, b.orig_package_id, v_veh);
    if v_price is not null then
      -- distribute_package_fares copies each leg's sell_rate into normal_rate, then
      -- spreads the package price across the non-extra legs (largest-remainder on
      -- the last leg). Legs already carry their single-route rate, so this is the
      -- correct base.
      perform distribute_package_fares(b.id, true, v_price);
      update transport_bookings set booking_type = 'package', package_id = b.orig_package_id,
        orig_package_id = null where id = b.id;
      v_restored := true;
    end if;
  end if;

  -- Recompute booking totals from the (now all active) trips.
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
    jsonb_build_object('trip', p_trip, 'restored_package', v_restored));
end $function$;

grant execute on function transport_reopen_trip(uuid) to authenticated;
