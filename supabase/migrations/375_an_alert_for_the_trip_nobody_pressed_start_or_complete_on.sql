-- ============================================================
-- 375 — An alert for the trip nobody pressed Start or Complete on
--
-- A trip's status is only ever moved by a person pressing Start, Picked Up and
-- Complete, so a forgotten press leaves a trip "in progress" for days and a
-- driver "on the road" who is asleep at home (migration 374 was the clean-up of
-- exactly that). Nothing told anybody. This is the thing that tells them, and it
-- is an ALERT on the screen — the header, the dashboard and the operations board
-- — not a notification: it is there for as long as the trip is wrong and goes
-- away the moment somebody fixes it.
--
-- Two rules, both measured from the trip's own timetable (transport_trip_sched:
-- pickup = trip_date + trip_time, end = pickup + the route's driving minutes):
--
--   not_picked_up  the pickup has not been recorded 3 hours after the
--                  scheduled pickup time. Pending, assigned, outsourced and
--                  driver-en-route trips all count — whoever should have
--                  pressed it, nobody did.
--   not_completed  the trip was started (Driver En Route / Picked Up) and is
--                  still open 1 hour after pickup + driving time.
--
-- A trip appears once, under one rule: a driver who pressed Start but never
-- Picked Up is "not picked up" once three hours have gone, and "not completed"
-- only in the window before that. A trip with no pickup time has no timetable
-- to be late against and is left out.
--
-- transport_trip_alerts() is the list; transport_trip_alert_summary() the
-- counts for the header pill; and the Transport dashboard card gets an "Alerts"
-- cell from dashboard_module_metrics. Both are security INVOKER so a restricted
-- user's alerts are the trips they may see.
-- ============================================================
begin;

create or replace function public.transport_trip_alerts()
returns table(
  trip_id uuid, booking_id uuid, booking_no text, passenger_name text, route text,
  trip_date date, trip_time time, status text, kind text, due_at timestamp, overdue_min integer,
  driver_name text, driver_mobile text, agent_name text,
  payment_method text, collect_amount numeric, sell_rate numeric)
language sql stable security invoker
set search_path to 'public'
as $function$
  with s as (
    select t.id, t.booking_id, t.trip_date, t.trip_time, t.status, t.driver_id, t.sell_rate,
           t.outsource_driver_name, t.outsource_driver_mobile,
           coalesce(r.name, t.route_label) as route,
           (t.trip_date + t.trip_time) as sched_s,
           (t.trip_date + t.trip_time + make_interval(mins => coalesce(r.driving_minutes, 60))) as sched_e
    from transport_trips t
    left join transport_routes r on r.id = t.route_id
    where t.company_id = auth_company_id()
      and t.trip_time is not null
      and t.status not in ('completed', 'cancelled')
  ),
  k as (
    select s.*,
      case
        when s.status in ('pending', 'assigned', 'outsourced', 'outsource_required', 'on_route')
             and s.sched_s + interval '3 hours' < localtimestamp then 'not_picked_up'
        when s.status in ('on_route', 'picked_up')
             and s.sched_e + interval '1 hour' < localtimestamp then 'not_completed'
      end as kind,
      case
        when s.status in ('pending', 'assigned', 'outsourced', 'outsource_required', 'on_route')
             and s.sched_s + interval '3 hours' < localtimestamp then s.sched_s + interval '3 hours'
        else s.sched_e + interval '1 hour'
      end as due_at
    from s
  )
  select k.id, k.booking_id, b.booking_no, b.passenger_name, k.route, k.trip_date, k.trip_time, k.status, k.kind,
         k.due_at, floor(extract(epoch from (localtimestamp - k.due_at)) / 60)::int,
         coalesce(d.name, k.outsource_driver_name), coalesce(d.mobile, k.outsource_driver_mobile),
         p.name, b.payment_method, b.collect_amount, k.sell_rate
  from k
  join transport_bookings b on b.id = k.booking_id
  left join transport_drivers d on d.id = k.driver_id
  left join parties p on p.id = b.agent_id
  where k.kind is not null
  order by k.trip_date desc, k.trip_time desc;
$function$;

create or replace function public.transport_trip_alert_summary()
returns jsonb
language sql stable security invoker
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'not_picked_up', count(*) filter (where kind = 'not_picked_up'),
    'not_completed', count(*) filter (where kind = 'not_completed'),
    'total', count(*))
  from transport_trip_alerts();
$function$;

revoke all on function public.transport_trip_alerts() from public, anon;
revoke all on function public.transport_trip_alert_summary() from public, anon;
grant execute on function public.transport_trip_alerts() to authenticated;
grant execute on function public.transport_trip_alert_summary() to authenticated;

-- The Transport card: one more cell, read off the same list.
create or replace function public.dashboard_module_metrics()
returns jsonb
language sql stable
set search_path to 'public'
as $function$
with
  co as (select auth_company_id() as id),
  today as (select current_date as d),
  -- BRN bed maths, per night, exactly as the BRN dashboard computed it.
  brn_nights as (
    select b.id, b.city, b.beds, b.check_in, b.check_out, n::date as night,
           b.beds - coalesce((select sum(c.beds) from brn_consumption c
             where c.brn_id = b.id and c.check_in <= n::date and c.check_out > n::date), 0) as free
    from brn_inventory b, generate_series(b.check_in, b.check_out - interval '1 day', interval '1 day') n
    where b.company_id = (select id from co)
  ),
  brn_live as (select * from brn_inventory where company_id = (select id from co) and check_out > (select d from today)),
  hp as (
    select coalesce(sum(p.purchase_total), 0) as purchase,
           coalesce(sum(greatest(coalesce(bi.total,0) - coalesce(bi.amount_paid,0), 0)), 0) as outstanding,
           count(*) filter (where p.hcn_status = 'pending')  as hcn_pending,
           count(*) filter (where p.hcn_status = 'received') as hcn_received
    from hotel_purchase_bookings p left join bills bi on bi.id = p.bill_id
  )
select jsonb_build_object(
  'approvals', jsonb_build_object(
    'pending', (select count(*) from pending_vouchers
                 where company_id = (select id from co) and status = 'pending'),
    'amount',  (select coalesce(sum(amount), 0) from pending_vouchers
                 where company_id = (select id from co) and status = 'pending')),

  'pdc', jsonb_build_object(
    'due_soon', (select count(*) from pdc_register where company_id = (select id from co)
                  and status = 'pending' and cheque_date <= (select d from today) + 14),
    'pending',  (select count(*) from pdc_register where company_id = (select id from co) and status = 'pending'),
    'amount',   (select coalesce(sum(amount_base), 0) from pdc_register
                  where company_id = (select id from co) and status = 'pending')),

  'car_contracts', (select jsonb_build_object(
      'total',     count(*),
      'active',    count(*) filter (where status = 'active'),
      'completed', count(*) filter (where status = 'completed'),
      'value',     coalesce(sum(net_payable), 0))
    from car_contracts where company_id = (select id from co)),

  'car_service_charges', (select jsonb_build_object(
      'this_month',  coalesce(sum(amount) filter (where charge_month >= date_trunc('month', (select d from today))::date
                       and charge_month < (date_trunc('month', (select d from today)) + interval '1 month')::date), 0),
      'outstanding', coalesce(sum(greatest(amount - paid_amount, 0)), 0),
      'overdue',     coalesce(sum(greatest(amount - paid_amount, 0)) filter (where due_date < (select d from today)), 0))
    from car_service_charges where company_id = (select id from co)),

  'car_ownership', (select jsonb_build_object(
      'transferred', count(*) filter (where ownership = 'transferred'),
      'vista',       count(*) filter (where ownership = 'vista'),
      'held',        count(*) filter (where status = 'held'),
      'vista_value', coalesce(sum(total_cost) filter (where ownership = 'vista'), 0),
      'total',       count(*))
    from car_vehicles where company_id = (select id from co)),

  'hotel_financials', (select jsonb_build_object(
      'sales',    (select coalesce(sum(sale_total), 0) from hotel_bookings
                    where company_id = (select id from co) and status <> 'cancelled'),
      'purchase', hp.purchase,
      'profit',   (select coalesce(sum(sale_total), 0) from hotel_bookings
                    where company_id = (select id from co) and status <> 'cancelled') - hp.purchase,
      'outstanding', hp.outstanding,
      'hcn_pending', hp.hcn_pending, 'hcn_received', hp.hcn_received) from hp),

  'brn_beds', jsonb_build_object(
    'purchased', (select coalesce(sum(beds), 0) from brn_live),
    'reserved',  (select coalesce(sum(c.beds), 0) from brn_consumption c
                   join brn_inventory b on b.id = c.brn_id where b.company_id = (select id from co)),
    'capacity_nights', (select count(*) * 0 + coalesce(sum(beds), 0) from brn_nights),
    'occupancy', (select case when coalesce(sum(beds), 0) = 0 then 0
                    else round(100.0 * coalesce(sum(beds - free), 0) / sum(beds)) end from brn_nights)),

  'brn_availability', jsonb_build_object(
    'makkah',  (select coalesce(sum(greatest(free, 0)), 0) from brn_nights
                 where city = 'Makkah'  and night = (select d from today)),
    'madinah', (select coalesce(sum(greatest(free, 0)), 0) from brn_nights
                 where city = 'Madinah' and night = (select d from today)),
    'checkin_today',  (select count(*) from brn_live where check_in  = (select d from today)),
    'checkout_today', (select count(*) from brn_inventory where company_id = (select id from co)
                        and check_out = (select d from today))),

  'brn_agreements', jsonb_build_object(
    'active',   (select count(*) from brn_live),
    'expiring', (select count(*) from brn_live where check_out <= (select d from today) + 7),
    'total',    (select count(*) from brn_inventory where company_id = (select id from co)),
    'supplier_outstanding', (select coalesce(sum(greatest(total - amount_paid, 0)), 0) from bills
                              where company_id = (select id from co) and status not in ('paid', 'void'))),

  'transport', jsonb_build_object(
    'pending',   (select count(*) from transport_bookings
                   where company_id = (select id from co) and status = 'pending'),
    'revenue',   (select coalesce(sum(total_amount), 0) from transport_bookings
                   where company_id = (select id from co) and status <> 'cancelled'),
    'in_progress', (select count(*) from transport_trip_sched
                     where company_id = (select id from co) and status in ('on_route', 'picked_up')),
    'unassigned',  (select count(*) from transport_trip_sched
                     where company_id = (select id from co) and driver_id is null
                       and status not in ('cancelled', 'completed')),
    -- Trips nobody pressed Start / Picked Up / Complete on (migration 375).
    'alerts',      (select count(*) from transport_trip_alerts())),

  'visa_groups', (select jsonb_build_object(
      'total',    count(*),
      'process',  count(*) filter (where workflow_status = 'process'),
      'issued',   count(*) filter (where visa_status = 'issued'),
      'waiting_brn', count(*) filter (where workflow_status = 'process' and brn_avail = 'none'))
    from umrah_groups where company_id = (select id from co))
);
$function$;

-- ---------------------------------------------------------------------------
-- Post-conditions. Any failure rolls the whole migration back.
-- ---------------------------------------------------------------------------
do $chk$
declare
  v_auth boolean; v_anon boolean; v_n int; v_bad int; v_sum jsonb;
begin
  select bool_and(has_function_privilege('authenticated', p.oid, 'execute')),
         bool_or(has_function_privilege('anon', p.oid, 'execute'))
    into v_auth, v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('transport_trip_alerts', 'transport_trip_alert_summary');
  if v_auth is distinct from true then raise exception '375: staff cannot call the alert routines'; end if;
  if v_anon then raise exception '375: the alert routines are callable by anon'; end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'dashboard_module_metrics'
                    and pg_get_functiondef(p.oid) like '%transport_trip_alerts()%') then
    raise exception '375: the Transport card does not read the alerts';
  end if;

  -- Measured as the Super Admin: every row is one of the two kinds, none is a
  -- closed trip, and each is genuinely past its threshold.
  perform set_config('request.jwt.claims', '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);
  select count(*),
         count(*) filter (where kind not in ('not_picked_up', 'not_completed')
                             or status in ('completed', 'cancelled')
                             or overdue_min < 0
                             or (kind = 'not_completed' and status not in ('on_route', 'picked_up')))
    into v_n, v_bad from transport_trip_alerts();
  if v_bad > 0 then raise exception '375: % alert rows break their own rule', v_bad; end if;
  select transport_trip_alert_summary() into v_sum;
  if (v_sum->>'total')::int <> v_n then raise exception '375: summary % disagrees with the list (%)', v_sum, v_n; end if;
  if ((dashboard_module_metrics()->'transport')->>'alerts')::int <> v_n then
    raise exception '375: the Transport card cell disagrees with the list';
  end if;
  raise notice '375 ok: % trip alert(s) right now — %', v_n, v_sum;
end $chk$;

commit;
