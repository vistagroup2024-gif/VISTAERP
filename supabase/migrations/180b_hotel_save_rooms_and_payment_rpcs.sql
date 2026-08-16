-- Extend the full booking save to persist per-room rows + new stay fields, and add
-- small RPCs for payment status and vendor option date.

create or replace function public.hotel_booking_save_full(p_id uuid, p jsonb, p_stays jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_id uuid; v_no text; s jsonb; r jsonb; v_sid uuid; v_keep uuid[] := '{}'; v_ri int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then
    v_no := 'HTL-' || lpad(nextval('hotel_booking_seq')::text, 6, '0');
    insert into hotel_bookings(company_id, booking_no, created_by, guest_name)
    values (v_company, v_no, auth.uid(), coalesce(p->>'guest_name','')) returning id into v_id;
  else
    v_id := p_id;
  end if;

  update hotel_bookings set
    agent_id      = nullif(p->>'agent_id','')::uuid,
    agent_ref     = p->>'agent_ref',
    managed_by    = p->>'managed_by',
    source        = p->>'source',
    group_id      = nullif(p->>'group_id','')::uuid,
    group_no      = p->>'group_no',
    guest_name    = coalesce(nullif(p->>'guest_name',''), guest_name),
    mobile        = p->>'mobile',
    whatsapp      = p->>'whatsapp',
    nationality   = p->>'nationality',
    guests        = coalesce(nullif(p->>'guests','')::int, 1),
    hotel_requirements = p->>'hotel_requirements'
  where id = v_id and company_id = v_company;

  for s in select * from jsonb_array_elements(coalesce(p_stays, '[]'::jsonb)) loop
    if nullif(s->>'id','') is not null then
      v_sid := (s->>'id')::uuid;
      update hotel_purchase_bookings set
        supplier_id   = nullif(s->>'supplier_id','')::uuid,
        hotel_id      = nullif(s->>'hotel_id','')::uuid,
        hotel_name    = s->>'hotel_name',
        city          = nullif(s->>'city','')::city_type,
        room_type     = s->>'room_type',
        meal_plan     = s->>'meal_plan',
        check_in      = nullif(s->>'check_in','')::date,
        check_out     = nullif(s->>'check_out','')::date,
        rooms         = coalesce(nullif(s->>'rooms','')::int, 1),
        sale_rate     = coalesce(nullif(s->>'sale_rate','')::numeric, 0),
        sale_total    = coalesce(nullif(s->>'sale_total','')::numeric, 0),
        purchase_rate = coalesce(nullif(s->>'purchase_rate','')::numeric, 0),
        purchase_total= coalesce(nullif(s->>'purchase_total','')::numeric, 0),
        currency      = coalesce(nullif(s->>'currency',''), 'SAR'),
        supplier_ref  = s->>'supplier_ref',
        notes         = s->>'notes',
        option_date   = nullif(s->>'option_date','')::date,
        vendor_option_date = nullif(s->>'vendor_option_date','')::date,
        sort          = coalesce(nullif(s->>'sort','')::int, 0)
      where id = v_sid and booking_id = v_id and company_id = v_company;
    else
      insert into hotel_purchase_bookings(company_id, booking_id, supplier_id, hotel_id, hotel_name, city,
        room_type, meal_plan, check_in, check_out, rooms, sale_rate, sale_total,
        purchase_rate, purchase_total, currency, supplier_ref, notes, option_date, vendor_option_date, sort)
      values (v_company, v_id, nullif(s->>'supplier_id','')::uuid, nullif(s->>'hotel_id','')::uuid, s->>'hotel_name',
        nullif(s->>'city','')::city_type, s->>'room_type', s->>'meal_plan',
        nullif(s->>'check_in','')::date, nullif(s->>'check_out','')::date,
        coalesce(nullif(s->>'rooms','')::int, 1),
        coalesce(nullif(s->>'sale_rate','')::numeric, 0), coalesce(nullif(s->>'sale_total','')::numeric, 0),
        coalesce(nullif(s->>'purchase_rate','')::numeric, 0), coalesce(nullif(s->>'purchase_total','')::numeric, 0),
        coalesce(nullif(s->>'currency',''), 'SAR'), s->>'supplier_ref', s->>'notes',
        nullif(s->>'option_date','')::date, nullif(s->>'vendor_option_date','')::date,
        coalesce(nullif(s->>'sort','')::int, 0))
      returning id into v_sid;
    end if;
    v_keep := array_append(v_keep, v_sid);

    -- Rebuild per-room breakdown for this stay.
    delete from hotel_stay_rooms where stay_id = v_sid and company_id = v_company;
    v_ri := 0;
    for r in select * from jsonb_array_elements(coalesce(s->'rooms_detail', '[]'::jsonb)) loop
      insert into hotel_stay_rooms(company_id, booking_id, stay_id, sort, room_type, meal_plan, suite_type,
        sale_dbl, sale_extra, sale_suite, purchase_dbl, purchase_extra, purchase_suite)
      values (v_company, v_id, v_sid, v_ri, coalesce(nullif(r->>'room_type',''),'dbl'), r->>'meal_plan', r->>'suite_type',
        coalesce(nullif(r->>'sale_dbl','')::numeric,0), coalesce(nullif(r->>'sale_extra','')::numeric,0), coalesce(nullif(r->>'sale_suite','')::numeric,0),
        coalesce(nullif(r->>'purchase_dbl','')::numeric,0), coalesce(nullif(r->>'purchase_extra','')::numeric,0), coalesce(nullif(r->>'purchase_suite','')::numeric,0));
      v_ri := v_ri + 1;
    end loop;
  end loop;

  delete from hotel_purchase_bookings
  where booking_id = v_id and company_id = v_company and not (id = any(v_keep));

  perform hotel_booking_rollup(v_id);
  perform hotel_log(v_id, case when p_id is null then 'hotel_booking_create' else 'hotel_booking_update' end, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function public.hotel_booking_save_full(uuid, jsonb, jsonb) from anon;

-- Set a manual payment status for a stay (kind = 'vendor' | 'customer').
create or replace function public.hotel_stay_set_payment(p_id uuid, p_kind text, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_booking uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_kind = 'vendor' then
    if p_status not in ('pending','partial','paid') then raise exception 'Invalid vendor payment status'; end if;
    update hotel_purchase_bookings set vendor_payment = p_status
      where id = p_id and company_id = v_company returning booking_id into v_booking;
  elsif p_kind = 'customer' then
    if p_status not in ('pending','partial','rcvd') then raise exception 'Invalid customer payment status'; end if;
    update hotel_purchase_bookings set customer_payment = p_status
      where id = p_id and company_id = v_company returning booking_id into v_booking;
  else
    raise exception 'Invalid payment kind';
  end if;
  if v_booking is null then raise exception 'Stay not found'; end if;
end $$;
revoke all on function public.hotel_stay_set_payment(uuid, text, text) from anon;

-- Capture / update the vendor option date (payment due date agreed with vendor).
create or replace function public.hotel_stay_set_vendor_option(p_id uuid, p_date date)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id();
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update hotel_purchase_bookings set vendor_option_date = p_date
    where id = p_id and company_id = v_company;
end $$;
revoke all on function public.hotel_stay_set_vendor_option(uuid, date) from anon;
