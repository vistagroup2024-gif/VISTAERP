-- 168 Honor the selected payment method on agent bookings.
--
-- transport_save_booking() forced payment_method to NULL for any booking with an
-- agent, discarding a staff selection of Cash. A null method reads as "not cash"
-- everywhere (operations board, copy trip, cash-received prompt, trip ledger), so
-- an agent booking marked Cash still showed NO CASH and never collected cash.
--
-- Now the explicitly selected method is always kept; only when nothing valid is
-- provided do we fall back to the default (direct -> cash, agent -> no_cash). So a
-- Cash agent booking behaves as cash end to end.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

create or replace function public.transport_save_booking(p_id uuid, p_header jsonb, p_trips jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_id uuid := p_id; v_company uuid := auth_company_id(); v_no text;
  v_type text := coalesce(p_header->>'booking_type', 'single');
  v_sell numeric := 0; v_extra numeric := 0; v_total numeric; v_disc numeric := 0; v_net numeric;
  v_pkg_price numeric := 0;
  v_pkg uuid := nullif(p_header->>'package_id','')::uuid;
  v_pkg_veh uuid := nullif(p_header->>'package_vehicle_id','')::uuid;
  v_agent uuid := nullif(p_header->>'agent_id','')::uuid;
  v_bdate date := coalesce(nullif(p_header->>'booking_date','')::date, current_date);
  v_pax int := nullif(p_header->>'pax','')::int; x jsonb; v_xveh uuid;
  v_pay text;
  v_units int := greatest(1, coalesce(nullif(p_header->>'vehicle_units','')::int, 1));
  v_pname text; v_sc_type text; v_sc_val numeric; v_sc_amt numeric := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  -- Keep the explicitly chosen method (incl. Cash on an agent booking); otherwise
  -- default: direct -> cash, agent -> no_cash.
  v_pay := case
    when p_header->>'payment_method' in ('cash','card','bank_transfer','no_cash') then p_header->>'payment_method'
    when v_agent is null then 'cash'
    else 'no_cash' end;

  if v_type = 'package' and v_pkg is not null then
    v_pkg_price := coalesce(transport_package_price(v_company, v_agent, v_pkg, v_pkg_veh), 0) * v_units;
    v_sell := v_pkg_price;
    for x in select * from jsonb_array_elements(coalesce(p_trips,'[]'::jsonb)) loop
      v_xveh := coalesce(nullif(x->>'vehicle_id','')::uuid, v_pkg_veh);
      if coalesce((x->>'is_extra')::boolean,false) then
        v_sell := v_sell + coalesce(transport_agent_rate(v_company, v_agent, nullif(x->>'route_id','')::uuid, v_xveh, v_bdate),
                    case when coalesce(x->>'sell_rate','') <> '' then greatest(0,(x->>'sell_rate')::numeric) else 0 end);
      end if;
      if coalesce((x->>'hajj_terminal')::boolean,false) then
        v_extra := v_extra + transport_route_extra(v_company, nullif(x->>'route_id','')::uuid, v_xveh);
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

  v_sc_type := nullif(p_header->>'surcharge_type','');
  v_sc_val := coalesce(nullif(p_header->>'surcharge_value','')::numeric, 0);
  if v_agent is not null then select upper(btrim(name)) into v_pname from parties where id = v_agent; end if;
  if v_pname in ('CASH CUSTOMER','UMRAH PACKAGE CUSTOMER') and v_sc_type in ('amount','percentage') and v_sc_val > 0 then
    v_sc_amt := case when v_sc_type = 'percentage' then round((v_net + v_extra) * v_sc_val / 100, 2) else v_sc_val end;
  else
    v_sc_type := null; v_sc_val := 0; v_sc_amt := 0;
  end if;
  v_total := v_net + v_extra + v_sc_amt;

  if v_id is null then
    v_no := 'TRP-' || lpad(nextval('transport_booking_seq')::text, 6, '0');
    insert into transport_bookings(company_id, booking_no, booking_type, status, agent_id, package_id,
      booking_date, pax, passenger_name, mobile, whatsapp, nationality, remarks, nusuk_group_no,
      sell_amount, discount, additional_charges, net_amount, total_amount, currency, payment_method,
      surcharge_type, surcharge_value, surcharge_amount, created_by)
    values (v_company, v_no, v_type, coalesce(p_header->>'status','draft'), v_agent, v_pkg,
      v_bdate, v_pax, p_header->>'passenger_name', p_header->>'mobile', p_header->>'whatsapp',
      p_header->>'nationality', p_header->>'remarks', nullif(p_header->>'nusuk_group_no',''),
      v_sell, v_disc, v_extra, v_net, v_total, 'SAR', v_pay,
      v_sc_type, v_sc_val, v_sc_amt, auth.uid())
    returning id into v_id;
  else
    update transport_bookings set booking_type = v_type, status = coalesce(p_header->>'status', status),
      agent_id = v_agent, package_id = v_pkg, booking_date = v_bdate, pax = v_pax,
      passenger_name = p_header->>'passenger_name', mobile = p_header->>'mobile', whatsapp = p_header->>'whatsapp',
      nationality = p_header->>'nationality', remarks = p_header->>'remarks', nusuk_group_no = nullif(p_header->>'nusuk_group_no',''),
      sell_amount = v_sell, discount = v_disc, additional_charges = v_extra, net_amount = v_net, total_amount = v_total,
      payment_method = v_pay, surcharge_type = v_sc_type, surcharge_value = v_sc_val, surcharge_amount = v_sc_amt, updated_at = now()
    where id = v_id and company_id = v_company;
    if not found then raise exception 'Booking not found'; end if;
  end if;

  perform transport_sync_trips(v_company, v_id, v_agent, v_pkg_veh, v_bdate, p_trips, v_units);
  perform distribute_package_fares(v_id, v_type = 'package', v_pkg_price);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when p_id is null then 'transport_booking_created' else 'transport_booking_updated' end,
          'transport_bookings', v_id, jsonb_build_object('total', v_total, 'discount', v_disc, 'surcharge', v_sc_amt));
  return v_id;
end $function$;
