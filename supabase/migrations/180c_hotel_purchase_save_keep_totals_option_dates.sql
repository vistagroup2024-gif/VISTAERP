-- Per-room pricing owns the sale/purchase totals now, so the detail-page purchase
-- save must NOT recompute them from a stay-level rate. Keep existing rate/total when
-- the payload omits them, and persist the customer/vendor option dates.
create or replace function public.hotel_purchase_save(p_id uuid, p_booking uuid, p jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_id uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_id is null then
    insert into hotel_purchase_bookings(company_id, booking_id) values (v_company, p_booking) returning id into v_id;
  else v_id := p_id; end if;

  update hotel_purchase_bookings set
    supplier_id   = nullif(p->>'supplier_id','')::uuid,
    hotel_id      = coalesce(nullif(p->>'hotel_id','')::uuid, hotel_id),
    hotel_name    = coalesce(p->>'hotel_name', hotel_name),
    city          = coalesce(nullif(p->>'city','')::city_type, city),
    room_type     = coalesce(p->>'room_type', room_type),
    meal_plan     = coalesce(p->>'meal_plan', meal_plan),
    check_in      = coalesce(nullif(p->>'check_in','')::date, check_in),
    check_out     = coalesce(nullif(p->>'check_out','')::date, check_out),
    rooms         = coalesce(nullif(p->>'rooms','')::int, rooms),
    sale_rate     = coalesce(nullif(p->>'sale_rate','')::numeric, sale_rate),
    sale_total    = coalesce(nullif(p->>'sale_total','')::numeric, sale_total),
    purchase_rate = coalesce(nullif(p->>'purchase_rate','')::numeric, purchase_rate),
    purchase_total= coalesce(nullif(p->>'purchase_total','')::numeric, purchase_total),
    currency      = coalesce(nullif(p->>'currency',''), currency),
    supplier_ref  = p->>'supplier_ref',
    notes         = p->>'notes',
    option_date   = nullif(p->>'option_date','')::date,
    vendor_option_date = nullif(p->>'vendor_option_date','')::date
  where id = v_id and company_id = v_company;

  perform hotel_booking_rollup(p_booking);
  perform hotel_log(p_booking, 'hotel_purchase_save', '{}'::jsonb);
  return v_id;
end $$;
revoke all on function public.hotel_purchase_save(uuid, uuid, jsonb) from anon;
