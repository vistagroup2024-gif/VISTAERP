-- 167 Public hotel voucher: return all stays (multi-hotel vouchers).
--
-- The customer-facing voucher (/hv/<token>) showed only the header's primary
-- stay. Add a client-safe `stays` array so a multi-hotel booking renders every
-- hotel. Each stay exposes only guest-safe fields; the HCN is shown only once it
-- has been shared/sent (same rule as the header hcn).
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

create or replace function public.public_hotel_voucher(p_token text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'booking_no', hb.booking_no,
    'guest_name', hb.guest_name,
    'group_no', hb.group_no,
    'agent', pa.name,
    'hotel_name', coalesce(hb.hotel_name, h.name),
    'city', hb.city,
    'check_in', hb.check_in,
    'check_out', hb.check_out,
    'nights', hb.nights,
    'room_type', hb.room_type,
    'rooms', hb.rooms,
    'guests', hb.guests,
    'meal_plan', hb.meal_plan,
    'status', hb.status,
    'hcn', (select p.hcn from hotel_purchase_bookings p
             where p.booking_id = hb.id and p.hcn is not null and p.hcn_shared
             order by p.hcn_shared_at desc limit 1),
    'stays', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'hotel_name', coalesce(sh.name, s.hotel_name),
        'city', s.city,
        'check_in', s.check_in,
        'check_out', s.check_out,
        'nights', s.nights,
        'room_type', s.room_type,
        'rooms', s.rooms,
        'meal_plan', s.meal_plan,
        'hcn', case when s.hcn_shared or s.hcn_status = 'sent' then s.hcn end
      ) order by s.sort, s.created_at), '[]'::jsonb)
      from hotel_purchase_bookings s
      left join hotels sh on sh.id = s.hotel_id
      where s.booking_id = hb.id
    )
  )
  from hotel_bookings hb
  left join hotels h on h.id = hb.hotel_id
  left join parties pa on pa.id = hb.agent_id
  where hb.public_token = p_token;
$function$;
