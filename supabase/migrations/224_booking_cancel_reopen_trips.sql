-- 224_booking_cancel_reopen_trips.sql
-- Transport booking cancellation / reopen fixes:
--   1. Cancelling a booking must NOT touch completed trips. If any trip is already
--      completed, the booking is not fully cancelled — only the remaining (open)
--      trips are cancelled and the booking stays active. The UI shows a warning.
--   2. Reopening a cancelled booking must restore the trips that were cancelled BY
--      the booking cancellation back to normal (so Operations shows them again).
--      Trips cancelled individually (transport_cancel_trip) stay cancelled.
--
-- We track which trips were cancelled as part of a booking cancel with a flag,
-- so reopen restores exactly those.

alter table transport_trips add column if not exists cancelled_with_booking boolean not null default false;

-- Backfill: trips currently cancelled under a cancelled booking were cancelled by
-- the booking, so a future reopen should restore them.
update transport_trips t set cancelled_with_booking = true
from transport_bookings b
where b.id = t.booking_id and b.status = 'cancelled' and t.status = 'cancelled'
  and t.cancelled_with_booking = false;

-- One-time repair for bookings already reopened before this fix: an ACTIVE booking
-- whose every trip is still 'cancelled' is a reopened-but-not-restored booking.
-- Restore those trips so Operations shows them again.
do $$
begin
  update transport_trips t
    set status = case when t.driver_id is not null then 'assigned' else 'pending' end,
        cancelled_with_booking = false
  where t.status = 'cancelled'
    and exists (select 1 from transport_bookings b where b.id = t.booking_id and b.status not in ('cancelled','draft'))
    and not exists (select 1 from transport_trips t2 where t2.booking_id = t.booking_id and t2.status <> 'cancelled');
end $$;

-- ---------------------------------------------------------------------------
-- Cancel a whole booking, preserving completed trips.
-- Returns { partial, completed, cancelled_trips, booking_no }.
-- ---------------------------------------------------------------------------
create or replace function transport_cancel_booking(p_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_no text; v_completed int; v_open int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select booking_no into v_no from transport_bookings where id = p_id and company_id = v_company;
  if v_no is null then raise exception 'Booking not found'; end if;

  select count(*) filter (where status = 'completed'),
         count(*) filter (where status not in ('completed','cancelled'))
    into v_completed, v_open
  from transport_trips where booking_id = p_id;

  -- Cancel only the open (non-completed) trips; tag them so reopen can restore.
  update transport_trips set status = 'cancelled', driver_id = null, vendor_id = null,
    scheduled_start = null, scheduled_end = null, assigned_at = null, cancelled_with_booking = true
  where booking_id = p_id and status not in ('completed','cancelled');

  if v_completed > 0 then
    -- A completed trip exists → keep the booking active; only remaining trips cancelled.
    update transport_bookings set status = 'confirmed', cancel_requested = false, updated_at = now() where id = p_id;
  else
    update transport_bookings set status = 'cancelled', cancel_requested = false, updated_at = now() where id = p_id;
  end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'transport_booking_cancel', 'transport_bookings', p_id,
    jsonb_build_object('partial', v_completed > 0, 'completed', v_completed, 'cancelled_trips', v_open));

  return jsonb_build_object('partial', v_completed > 0, 'completed', v_completed,
    'cancelled_trips', v_open, 'booking_no', v_no);
end $function$;

grant execute on function transport_cancel_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Status transitions: cancel preserves completed trips; reopen restores the
-- trips cancelled by the booking cancel.
-- ---------------------------------------------------------------------------
create or replace function transport_set_booking_status(p_id uuid, p_status text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_status not in ('draft','pending','confirmed','assigned','on_route','picked_up','completed','cancelled') then
    raise exception 'Invalid status';
  end if;
  update transport_bookings set status = p_status, updated_at = now() where id = p_id and company_id = v_company;
  if not found then raise exception 'Booking not found'; end if;

  if p_status = 'cancelled' then
    -- Never cancel completed trips; tag the rest so a later reopen restores them.
    update transport_trips set status = 'cancelled', driver_id = null, vendor_id = null,
      scheduled_start = null, scheduled_end = null, assigned_at = null, cancelled_with_booking = true
    where booking_id = p_id and status not in ('completed','cancelled');
  else
    -- Reopen / any active status: restore trips cancelled by the booking cancel.
    update transport_trips set
      status = case when driver_id is not null then 'assigned' else 'pending' end,
      cancelled_with_booking = false
    where booking_id = p_id and status = 'cancelled' and cancelled_with_booking = true;
  end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'transport_booking_status', 'transport_bookings', p_id, jsonb_build_object('status', p_status));
end $function$;

-- Agent cancellation approval: same rule — keep completed trips, tag the rest,
-- and don't fully cancel a booking that already has a completed trip.
create or replace function transport_cancel_request_approve(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_no text; v_party uuid; v_agent uuid; v_completed int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select booking_no, agent_id into v_no, v_party
  from transport_bookings where id = p_id and company_id = v_company and cancel_requested;
  if v_no is null then raise exception 'No pending cancellation request for this booking.'; end if;

  select count(*) filter (where status = 'completed') into v_completed
  from transport_trips where booking_id = p_id;

  update transport_trips set status = 'cancelled', driver_id = null, vendor_id = null, cancelled_with_booking = true
  where booking_id = p_id and status not in ('completed','cancelled');

  update transport_bookings
    set status = case when v_completed > 0 then 'confirmed' else 'cancelled' end,
        cancel_requested = false, updated_at = now()
  where id = p_id;

  select id into v_agent from b2b_agents where agent_party_id = v_party or id = v_party limit 1;
  if v_agent is not null then
    perform push_notification('agent', v_agent, 'transport',
      'Cancellation approved — ' || coalesce(v_no,''),
      case when v_completed > 0
        then 'Your cancellation for booking ' || coalesce(v_no,'') || ' was approved for the remaining trips; completed trips remain.'
        else 'Your cancellation request for booking ' || coalesce(v_no,'') || ' has been approved. The booking is cancelled.' end,
      'transport', p_id);
  end if;
end $function$;
