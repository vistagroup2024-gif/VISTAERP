-- 228_agent_booking_payment_and_extra.sql
-- Agent transport booking fixes:
--   * Payment method: agents can now choose the payment method (default No Cash).
--     The RPC previously ignored it and always used the column default.
--   * Extra trips on a package: an extra trip added apart from the package carries
--     its own manual fare and must be ADDED ON TOP of the package price without
--     being folded into (or discounted by) the package distribution. The RPC set
--     the booking total to the package price only — dropping the extra-trip fare —
--     and distributed that (extra-inclusive) figure. Now it distributes only the
--     package price across the package legs and adds the extra-trip fares on top
--     of the booking total (matching the staff RPC).
create or replace function b2b_transport_save_booking(p_token text, p_id uuid, p_header jsonb, p_trips jsonb)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  a b2b_agents%rowtype; v_id uuid := p_id; v_no text; v_party uuid;
  v_type text := coalesce(p_header->>'booking_type','single');
  v_sell numeric := 0; v_extra numeric := 0; v_pkg_price numeric := 0;
  v_pkg uuid := nullif(p_header->>'package_id','')::uuid;
  v_pkg_veh uuid := nullif(p_header->>'package_vehicle_id','')::uuid;
  v_bdate date := coalesce(nullif(p_header->>'booking_date','')::date, current_date);
  v_pax int := nullif(p_header->>'pax','')::int; v_status text := coalesce(p_header->>'status','pending');
  v_pay text; v_collect numeric := nullif(p_header->>'collect_amount','')::numeric;
  existing transport_bookings%rowtype; x jsonb;
begin
  a := b2b_agent_of(p_token);
  v_party := coalesce(a.agent_party_id, a.id);
  if v_status not in ('draft','pending','cancelled') then v_status := 'pending'; end if;
  -- Agents may pick No Cash (default, billed to the agency) or Cash (collect from
  -- the passenger). Anything else falls back to No Cash.
  v_pay := case when p_header->>'payment_method' in ('cash','no_cash') then p_header->>'payment_method' else 'no_cash' end;
  if v_pay <> 'cash' then v_collect := null; end if;

  if v_type = 'package' and v_pkg is not null then
    v_pkg_price := coalesce(transport_package_price(a.company_id, v_party, v_pkg, v_pkg_veh), 0);
    v_sell := v_pkg_price;
    for x in select * from jsonb_array_elements(coalesce(p_trips,'[]'::jsonb)) loop
      -- Extra trips are priced individually and added on top of the package price.
      if coalesce((x->>'is_extra')::boolean,false) then
        v_sell := v_sell + coalesce(
          transport_agent_rate(a.company_id, v_party, nullif(x->>'route_id','')::uuid, nullif(x->>'vehicle_id','')::uuid, v_bdate),
          case when coalesce(x->>'sell_rate','') <> '' then greatest(0,(x->>'sell_rate')::numeric) else 0 end);
      end if;
      if coalesce((x->>'hajj_terminal')::boolean,false) then
        v_extra := v_extra + transport_route_extra(a.company_id, nullif(x->>'route_id','')::uuid, v_pkg_veh);
      end if;
    end loop;
  else
    for x in select * from jsonb_array_elements(coalesce(p_trips,'[]'::jsonb)) loop
      v_sell := v_sell + coalesce(transport_agent_rate(a.company_id, v_party, nullif(x->>'route_id','')::uuid, nullif(x->>'vehicle_id','')::uuid, v_bdate), 0);
      if coalesce((x->>'hajj_terminal')::boolean,false) then v_extra := v_extra + transport_route_extra(a.company_id, nullif(x->>'route_id','')::uuid, nullif(x->>'vehicle_id','')::uuid); end if;
    end loop;
  end if;

  if v_id is null then
    v_no := 'TRP-' || lpad(nextval('transport_booking_seq')::text, 6, '0');
    insert into transport_bookings(company_id, booking_no, booking_type, status, agent_id, package_id,
      booking_date, pax, passenger_name, mobile, whatsapp, nationality, remarks, nusuk_group_no,
      sell_amount, discount, additional_charges, net_amount, total_amount, currency, payment_method, collect_amount)
    values (a.company_id, v_no, v_type, v_status, v_party, v_pkg, v_bdate, v_pax,
      p_header->>'passenger_name', p_header->>'mobile', p_header->>'whatsapp', p_header->>'nationality', p_header->>'remarks',
      nullif(p_header->>'nusuk_group_no',''), v_sell, 0, v_extra, v_sell, v_sell + v_extra, 'SAR', v_pay, v_collect)
    returning id into v_id;
  else
    select * into existing from transport_bookings where id = v_id and company_id = a.company_id and agent_id = v_party;
    if not found then raise exception 'Booking not found'; end if;
    if existing.status not in ('draft','pending') then raise exception 'This booking is locked and can no longer be edited.'; end if;
    update transport_bookings set booking_type = v_type, status = v_status, package_id = v_pkg, booking_date = v_bdate,
      pax = v_pax, passenger_name = p_header->>'passenger_name', mobile = p_header->>'mobile', whatsapp = p_header->>'whatsapp',
      nationality = p_header->>'nationality', remarks = p_header->>'remarks', nusuk_group_no = nullif(p_header->>'nusuk_group_no',''),
      sell_amount = v_sell, discount = 0, additional_charges = v_extra, net_amount = v_sell, total_amount = v_sell + v_extra,
      payment_method = v_pay, collect_amount = v_collect, updated_at = now()
    where id = v_id;
  end if;

  perform transport_sync_trips(a.company_id, v_id, v_party, v_pkg_veh, v_bdate, p_trips);
  -- Distribute ONLY the package price across the package legs; extra trips keep
  -- their own fare (added to the booking total above).
  perform distribute_package_fares(v_id, v_type = 'package', v_pkg_price);
  return v_id;
end $function$;
