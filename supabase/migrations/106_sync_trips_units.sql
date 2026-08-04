-- ============================================================
-- VISTA ERP - 106 Units-aware trip sync (family vehicle-splitting)
-- The per-trip capacity guard now compares booking pax to the COMBINED capacity
-- of the split vehicles (cap * units), so a 10-pax family across 2x 7-seat vans
-- passes. transport_save_booking passes vehicle_units through and multiplies the
-- package price by it (non-package totals scale from the client duplicating legs).
-- (Applied to remote DB via Supabase MCP; full final definitions below.)
-- ============================================================
create or replace function public.transport_sync_trips(p_company uuid, p_booking uuid, p_agent uuid, p_pkg_veh uuid, p_bdate date, p_trips jsonb, p_units int default 1)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  t jsonb; idx int := 0; v_seq int; v_tveh uuid; v_rate numeric; v_tid uuid;
  v_hajj boolean; v_visa text; v_extra numeric; v_cap int; v_pax int;
  ex transport_trips%rowtype; v_keep uuid[] := '{}'; v_changed boolean; v_route uuid; v_tdate date; v_ttime time;
  v_units int := greatest(1, coalesce(p_units, 1));
begin
  select pax into v_pax from transport_bookings where id = p_booking;
  for t in select * from jsonb_array_elements(coalesce(p_trips, '[]'::jsonb)) loop
    idx := idx + 1;
    v_seq := coalesce(nullif(t->>'seq','')::int, idx);
    v_tveh := coalesce(nullif(t->>'vehicle_id','')::uuid, p_pkg_veh);
    v_route := nullif(t->>'route_id','')::uuid;
    v_tdate := nullif(t->>'trip_date','')::date;
    v_ttime := nullif(t->>'trip_time','')::time;
    v_hajj := coalesce((t->>'hajj_terminal')::boolean, false);
    v_visa := nullif(t->>'passenger_visa_type','');
    if p_pkg_veh is null and coalesce(t->>'sell_rate','') <> '' then
      v_rate := greatest(0, (t->>'sell_rate')::numeric);
    else
      v_rate := coalesce(transport_agent_rate(p_company, p_agent, v_route, v_tveh, p_bdate), 0);
    end if;
    v_extra := case when v_hajj then transport_route_extra(p_company, v_route, v_tveh) else 0 end;
    v_tid := nullif(t->>'id','')::uuid;
    if v_tveh is not null and v_pax is not null then
      select seating_capacity into v_cap from transport_vehicles where id = v_tveh;
      if v_cap is not null and v_pax > v_cap * v_units then
        raise exception 'Vehicle capacity (%) is less than total passengers (%). Choose a larger vehicle or more vehicles.', v_cap, v_pax;
      end if;
    end if;
    ex := null;
    if v_tid is not null then select * into ex from transport_trips where id = v_tid and booking_id = p_booking; end if;
    if ex.id is null then select * into ex from transport_trips where booking_id = p_booking and seq = v_seq order by created_at limit 1; end if;
    if ex.id is null then
      insert into transport_trips(company_id, booking_id, seq, route_id, route_label, vehicle_id, requested_vehicle_id,
        trip_date, trip_time, pickup_location, drop_location, flight_no, sell_rate, remarks, hajj_terminal, passenger_visa_type, extra_charge)
      values (p_company, p_booking, v_seq, v_route, t->>'route_label', v_tveh, v_tveh,
        v_tdate, v_ttime, t->>'pickup_location', t->>'drop_location', t->>'flight_no', v_rate, t->>'remarks', v_hajj, v_visa, v_extra)
      returning id into v_tid;
      v_keep := array_append(v_keep, v_tid);
    else
      v_keep := array_append(v_keep, ex.id);
      if ex.status = 'completed' and (ex.trip_date is distinct from v_tdate or ex.trip_time is distinct from v_ttime) then
        raise exception 'Completed trips cannot have their date or time changed.';
      end if;
      v_changed := (ex.route_id is distinct from v_route)
                or (ex.requested_vehicle_id is distinct from v_tveh)
                or (ex.trip_date is distinct from v_tdate)
                or (ex.trip_time is distinct from v_ttime)
                or (coalesce(ex.pickup_location,'') is distinct from coalesce(t->>'pickup_location',''))
                or (coalesce(ex.drop_location,'') is distinct from coalesce(t->>'drop_location',''));
      update transport_trips set
        seq = v_seq, route_id = v_route, route_label = t->>'route_label',
        requested_vehicle_id = v_tveh,
        vehicle_id = case when ex.driver_id is null then v_tveh else ex.vehicle_id end,
        trip_date = v_tdate, trip_time = v_ttime,
        pickup_location = t->>'pickup_location', drop_location = t->>'drop_location',
        flight_no = t->>'flight_no', sell_rate = v_rate, remarks = t->>'remarks',
        hajj_terminal = v_hajj, passenger_visa_type = v_visa, extra_charge = v_extra
      where id = ex.id;
      if ex.driver_id is not null and v_changed then
        if transport_vehicle_ok(ex.vehicle_id, v_tveh) and transport_vehicle_fits(ex.vehicle_id, p_booking)
           and transport_driver_reason(ex.id, ex.driver_id) is null then
          update transport_trips ttt set
            scheduled_start = s.sched_s, scheduled_end = s.sched_e,
            is_upgraded = (ex.vehicle_id is distinct from v_tveh),
            status = case when ttt.status in ('pending','outsource_required') then 'assigned' else ttt.status end
          from transport_trip_sched s where s.id = ex.id and ttt.id = ex.id;
        else
          update transport_trips set driver_id = null, vehicle_id = v_tveh, is_upgraded = false,
            status = 'pending', scheduled_start = null, scheduled_end = null, assigned_at = null
          where id = ex.id;
        end if;
      end if;
    end if;
  end loop;
  delete from transport_trips where booking_id = p_booking and not (id = any(v_keep));
end $function$;

create or replace function public.transport_save_booking(p_id uuid, p_header jsonb, p_trips jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_id uuid := p_id; v_company uuid := auth_company_id(); v_no text;
  v_type text := coalesce(p_header->>'booking_type', 'single');
  v_sell numeric := 0; v_extra numeric := 0; v_total numeric; v_disc numeric := 0; v_net numeric;
  v_pkg uuid := nullif(p_header->>'package_id','')::uuid;
  v_pkg_veh uuid := nullif(p_header->>'package_vehicle_id','')::uuid;
  v_agent uuid := nullif(p_header->>'agent_id','')::uuid;
  v_bdate date := coalesce(nullif(p_header->>'booking_date','')::date, current_date);
  v_pax int := nullif(p_header->>'pax','')::int; x jsonb;
  v_pay text;
  v_units int := greatest(1, coalesce(nullif(p_header->>'vehicle_units','')::int, 1));
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  v_pay := case when v_agent is null then
    (case when p_header->>'payment_method' in ('cash','card','bank_transfer') then p_header->>'payment_method' else 'cash' end)
    else null end;
  if v_type = 'package' and v_pkg is not null then
    v_sell := coalesce(transport_package_price(v_company, v_agent, v_pkg, v_pkg_veh), 0) * v_units;
    for x in select * from jsonb_array_elements(coalesce(p_trips,'[]'::jsonb)) loop
      if coalesce((x->>'hajj_terminal')::boolean,false) then
        v_extra := v_extra + transport_route_extra(v_company, nullif(x->>'route_id','')::uuid, v_pkg_veh);
      end if;
    end loop;
  else
    for x in select * from jsonb_array_elements(coalesce(p_trips,'[]'::jsonb)) loop
      v_sell := v_sell + case when coalesce(x->>'sell_rate','') <> ''
        then greatest(0, (x->>'sell_rate')::numeric)
        else coalesce(transport_agent_rate(v_company, v_agent, nullif(x->>'route_id','')::uuid, nullif(x->>'vehicle_id','')::uuid, v_bdate), 0) end;
      if coalesce((x->>'hajj_terminal')::boolean,false) then
        v_extra := v_extra + transport_route_extra(v_company, nullif(x->>'route_id','')::uuid, nullif(x->>'vehicle_id','')::uuid);
      end if;
    end loop;
  end if;
  v_disc := least(greatest(coalesce(nullif(p_header->>'discount','')::numeric, 0), 0), v_sell);
  v_net := v_sell - v_disc;
  v_total := v_net + v_extra;
  if v_id is null then
    v_no := 'TRP-' || lpad(nextval('transport_booking_seq')::text, 6, '0');
    insert into transport_bookings(company_id, booking_no, booking_type, status, agent_id, package_id,
      booking_date, pax, passenger_name, mobile, whatsapp, nationality, remarks, nusuk_group_no,
      sell_amount, discount, additional_charges, net_amount, total_amount, currency, payment_method, created_by)
    values (v_company, v_no, v_type, coalesce(p_header->>'status','draft'), v_agent, v_pkg,
      v_bdate, v_pax, p_header->>'passenger_name', p_header->>'mobile', p_header->>'whatsapp',
      p_header->>'nationality', p_header->>'remarks', nullif(p_header->>'nusuk_group_no',''),
      v_sell, v_disc, v_extra, v_net, v_total, 'SAR', v_pay, auth.uid())
    returning id into v_id;
  else
    update transport_bookings set booking_type = v_type, status = coalesce(p_header->>'status', status),
      agent_id = v_agent, package_id = v_pkg, booking_date = v_bdate, pax = v_pax,
      passenger_name = p_header->>'passenger_name', mobile = p_header->>'mobile', whatsapp = p_header->>'whatsapp',
      nationality = p_header->>'nationality', remarks = p_header->>'remarks', nusuk_group_no = nullif(p_header->>'nusuk_group_no',''),
      sell_amount = v_sell, discount = v_disc, additional_charges = v_extra, net_amount = v_net, total_amount = v_total,
      payment_method = v_pay, updated_at = now()
    where id = v_id and company_id = v_company;
    if not found then raise exception 'Booking not found'; end if;
  end if;
  perform transport_sync_trips(v_company, v_id, v_agent, v_pkg_veh, v_bdate, p_trips, v_units);
  perform distribute_package_fares(v_id, v_type = 'package', v_sell);
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when p_id is null then 'transport_booking_created' else 'transport_booking_updated' end,
          'transport_bookings', v_id, jsonb_build_object('total', v_total, 'discount', v_disc));
  return v_id;
end $function$;
