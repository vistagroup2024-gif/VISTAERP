-- 288 The module dashboards' figures move to the one dashboard, so those
-- screens can be removed.
--
-- 287 gathered the 14 cards that were asked for. This adds the figures that
-- only ever existed on a module dashboard — Pending Approvals and the PDC
-- register (/accounting), car contracts, monthly service charges and vehicle
-- ownership (/car-sales), hotel sales/purchase/profit and HCN (/hotels), BRN
-- beds, availability tonight and agreements (/inventory), the transport board
-- and the visa pipeline — so nothing is lost when those pages go.
--
-- A second function rather than folded into dashboard_metrics(): these read a
-- different half of the database (Umrah, transport, hotels), and a dashboard
-- showing none of these cards should not pay for the query.
create or replace function public.dashboard_module_metrics()
returns jsonb language sql stable security invoker set search_path to 'public' as $$
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
      'value',     coalesce(sum(sale_price), 0))
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
                       and status not in ('cancelled', 'completed'))),

  'visa_groups', (select jsonb_build_object(
      'total',    count(*),
      'process',  count(*) filter (where workflow_status = 'process'),
      'issued',   count(*) filter (where visa_status = 'issued'),
      'waiting_brn', count(*) filter (where workflow_status = 'process' and brn_avail = 'none'))
    from umrah_groups where company_id = (select id from co))
);
$$;

revoke all on function public.dashboard_module_metrics() from anon;
