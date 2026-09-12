-- The HCN reminders were counting back from the wrong moment, and to the wrong
-- distances.
--
-- THE BUG, first, because it made every figure wrong rather than merely early:
-- the job measured hours remaining as
--
--     (r.check_in::timestamp) - now()
--
-- and check_in is a DATE. Casting a date to a timestamp gives MIDNIGHT on that
-- day, so the countdown ran to 00:00 — fourteen hours before the guest actually
-- arrives. Every "~Nh left" in every HCN reminder ever sent was 14 hours short,
-- and the thresholds were measured to a moment that is not check-in.
--
-- Check-in is 14:00 Saudi time. That is now stated once, as HCN_CHECKIN_TIME
-- below, and the countdown runs to `check_in + 14:00`.
--
-- THE DISTANCES CHANGE TOO, to what the business actually wants:
--
--     24h before 14:00  ->  14:00 the previous day   HCN Pending – Action Required
--     12h before 14:00  ->  02:00 on the day         Urgent: HCN Not Received
--      4h before 14:00  ->  10:00 on the day         Critical: Guest Check-in Today – HCN Missing
--
-- It was 48h / 24h / check-in-day, measured to midnight — so the "48h" notice
-- actually went out 62 hours before the guest arrived and the "check-in day" one
-- could fire at 00:00, fourteen hours before anybody could do anything about it.
--
-- WHY THE TIGHTEST THRESHOLD WINS. The job runs hourly and each threshold is
-- deduped separately, so a booking walks 24 -> 12 -> 4 as the day closes. If the
-- job misses runs — a deploy, an outage — and a booking jumps from 30h to 10h,
-- it fires 12 and SKIPS 24 rather than sending both: a "24 hours to go" warning
-- delivered 10 hours before check-in is not a reminder, it is a lie about the
-- clock.
--
-- AND IT STILL FIRES AFTER 14:00. A guest checking in at 14:00 with no HCN at
-- 16:00 is the most urgent case there is, so the 4h threshold is `<= 4`, not
-- `between 0 and 4`. The scan window stops at the end of the check-in day, and
-- the dedup means it is said once.
--
-- The old thresholds (0 and 48) are left in hotel_hcn_reminder_sent. They are
-- history, they match nothing the job now asks for, and deleting them would
-- re-send warnings for bookings that already had them.

begin;

create or replace function public.generate_hotel_hcn_reminders(p_secret text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Hotel check-in, Saudi wall-clock. One place, because three thresholds and a
  -- message all count back from it.
  HCN_CHECKIN_TIME constant time := time '14:00';
  r record; v_left numeric; v_threshold int; v_title text; v_body text;
  v_due timestamp; n int := 0;
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
      -- The earliest notice is 24h before 14:00, i.e. 14:00 the day before, so
      -- nothing further out than tomorrow can be due. Today is included to the
      -- end of the day so a check-in that has already passed without an HCN is
      -- still chased.
      and b.check_in >= current_date
      and b.check_in <= current_date + 1
  loop
    v_due  := r.check_in + HCN_CHECKIN_TIME;
    -- localtimestamp, not now(): the roles carry Asia/Riyadh (migration 311),
    -- so this is Saudi wall-clock against a Saudi wall-clock check-in and there
    -- is no zone left to get wrong.
    v_left := extract(epoch from (v_due - localtimestamp)) / 3600.0;

    -- The tightest threshold reached, so a late run says where we ARE rather
    -- than replaying a warning whose hour has gone.
    if    v_left <= 4  then v_threshold := 4;
    elsif v_left <= 12 then v_threshold := 12;
    elsif v_left <= 24 then v_threshold := 24;
    else  continue;
    end if;

    if exists (select 1 from hotel_hcn_reminder_sent s
                where s.purchase_id = r.purchase_id and s.threshold = v_threshold) then
      continue;
    end if;

    v_title := case v_threshold
      when 24 then 'HCN Pending – Action Required'
      when 12 then 'Urgent: HCN Not Received'
      else         'Critical: Guest Check-in Today – HCN Missing'
    end;

    v_body := r.booking_no || ' · ' || coalesce(r.guest_name,'') || ' · '
              || coalesce(r.hotel_name,'hotel')
              || ' · check-in ' || to_char(v_due, 'DD Mon HH24:MI')
              || case when v_left >= 0 then ' · ~' || round(v_left) || 'h left'
                      else ' · check-in time has passed' end;

    perform push_notification('staff', null, 'hotel', v_title, v_body, 'hotels', r.booking_id);
    insert into hotel_hcn_reminder_sent(purchase_id, threshold) values (r.purchase_id, v_threshold)
      on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $function$;

do $chk$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='generate_hotel_hcn_reminders';

  -- the countdown must run to 14:00, not to a bare date cast
  if v_def not like '%HCN_CHECKIN_TIME%' then
    raise exception '354: the check-in time is not stated';
  end if;
  if v_def like '%check_in::timestamp%' then
    raise exception '354: still counting back from midnight';
  end if;
  -- and to the three distances asked for
  if v_def not like '%v_left <= 4%' or v_def not like '%v_left <= 12%' or v_def not like '%v_left <= 24%' then
    raise exception '354: the 24 / 12 / 4 thresholds are not all present';
  end if;
  if v_def like '%48%' then
    raise exception '354: the old 48h threshold is still there';
  end if;
end $chk$;

commit;
