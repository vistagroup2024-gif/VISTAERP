-- 223_hotel_voucher_room_summary.sql
-- Hotel voucher: show the real per-room-type mix (e.g. "2 Quad · 1 Triple (TPL)")
-- instead of the single stay-level room_type. A stay can hold several rooms of
-- different types (hotel_stay_rooms); the voucher previously showed only the
-- stay's first/aggregate room_type, so a 2-quad + 1-triple booking read as
-- "3 rooms / TPL". Add a room_summary built from hotel_stay_rooms to each stay
-- and to the booking, used by the public (QR) hotel voucher.

-- Helper: summarise a stay's rooms by type, ordered single→dbl→tpl→quad→quint→suite.
create or replace function hotel_room_type_summary(p_stay uuid)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select string_agg(c || ' ' || lbl, ' · ' order by ord)
  from (
    select count(*) as c,
      case r.room_type
        when 'single' then 'Single' when 'dbl' then 'Double (DBL)' when 'tpl' then 'Triple (TPL)'
        when 'quad' then 'Quad' when 'quint' then 'Quint' when 'suite' then 'Suite (manual)'
        else initcap(r.room_type) end as lbl,
      min(case r.room_type
        when 'single' then 1 when 'dbl' then 2 when 'tpl' then 3
        when 'quad' then 4 when 'quint' then 5 when 'suite' then 6 else 9 end) as ord
    from hotel_stay_rooms r
    where r.stay_id = p_stay
    group by r.room_type
  ) q;
$$;

create or replace function public_hotel_voucher(p_token text)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
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
    'room_summary', (
      select string_agg(c || ' ' || lbl, ' · ' order by ord)
      from (
        select count(*) as c,
          case r.room_type
            when 'single' then 'Single' when 'dbl' then 'Double (DBL)' when 'tpl' then 'Triple (TPL)'
            when 'quad' then 'Quad' when 'quint' then 'Quint' when 'suite' then 'Suite (manual)'
            else initcap(r.room_type) end as lbl,
          min(case r.room_type
            when 'single' then 1 when 'dbl' then 2 when 'tpl' then 3
            when 'quad' then 4 when 'quint' then 5 when 'suite' then 6 else 9 end) as ord
        from hotel_stay_rooms r
        where r.booking_id = hb.id
        group by r.room_type
      ) q
    ),
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
        'room_summary', hotel_room_type_summary(s.id),
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

grant execute on function hotel_room_type_summary(uuid) to anon, authenticated;
grant execute on function public_hotel_voucher(text) to anon, authenticated;
