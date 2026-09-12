-- Undo 354. The HCN reminders go back to 48h / 24h / check-in-day measured to
-- MIDNIGHT on the check-in day — which means every "~Nh left" is 14 hours short
-- again, and the check-in-day notice can fire at 00:00.
--
-- hotel_hcn_reminder_sent is left alone. It now holds 24/12/4 rows from the new
-- scheme alongside the old 0/48 ones; the restored job asks only for 0/24/48, so
-- a booking that got the new 12h or 4h notice is simply not re-warned at those
-- distances, and one that got the new 24h notice keeps that dedup.

begin;

create or replace function public.generate_hotel_hcn_reminders(p_secret text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_hours numeric; v_threshold int; v_title text; v_body text; n int := 0;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  for r in
    select p.id as purchase_id, p.company_id, b.id as booking_id, b.booking_no, b.guest_name,
           coalesce(b.hotel_name, h.name) as hotel_name, b.check_in
    from hotel_purchase_bookings p
    join hotel_bookings b on b.id = p.booking_id
    left join hotels h on h.id = b.hotel_id
    where b.status not in ('completed','cancelled')
      and coalesce(p.hcn_status,'pending') = 'pending'
      and b.check_in is not null
      and b.check_in >= current_date
      and b.check_in <= current_date + 2
  loop
    v_hours := extract(epoch from ((r.check_in::timestamp) - now())) / 3600;
    if r.check_in = current_date then v_threshold := 0;
    elsif v_hours <= 24 then v_threshold := 24;
    else v_threshold := 48; end if;
    if exists (select 1 from hotel_hcn_reminder_sent s where s.purchase_id = r.purchase_id and s.threshold = v_threshold) then
      continue;
    end if;
    if v_threshold = 0 then
      v_title := 'Critical: Guest Check-in Today – HCN Missing';
    elsif v_threshold = 24 then
      v_title := 'Urgent: HCN Not Received';
    else
      v_title := 'HCN Pending – Action Required';
    end if;
    v_body := r.booking_no || ' · ' || coalesce(r.guest_name,'') || ' · ' || coalesce(r.hotel_name,'hotel')
              || ' · check-in ' || to_char(r.check_in,'DD Mon');
    perform push_notification('staff', null, 'hotel', v_title, v_body, 'hotels', r.booking_id);
    insert into hotel_hcn_reminder_sent(purchase_id, threshold) values (r.purchase_id, v_threshold)
      on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $function$;

commit;
