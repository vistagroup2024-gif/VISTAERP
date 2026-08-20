-- Allow permanently deleting a CANCELLED hotel booking (rooms + stays + agreements + header).
create or replace function public.hotel_booking_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_company uuid := auth_company_id(); v_status text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select status::text into v_status from hotel_bookings where id = p_id and company_id = v_company;
  if v_status is null then raise exception 'Booking not found'; end if;
  if v_status <> 'cancelled' then raise exception 'Only a cancelled booking can be deleted. Cancel it first.'; end if;
  perform hotel_log(p_id, 'hotel_booking_delete', '{}'::jsonb);
  delete from hotel_stay_rooms where booking_id = p_id and company_id = v_company;
  delete from hotel_purchase_bookings where booking_id = p_id and company_id = v_company;
  delete from nusuk_agreements where booking_id = p_id and company_id = v_company;
  delete from hotel_bookings where id = p_id and company_id = v_company;
end $function$;
revoke all on function public.hotel_booking_delete(uuid) from anon;
