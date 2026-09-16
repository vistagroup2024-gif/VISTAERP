-- The Air Ticket Invoice has always been a complete, posting voucher — a
-- customer, a supplier, four legs, a bill each side. What was missing is
-- everything BEFORE it: the airline/GDS hold, created the moment a fare is
-- booked outside the ERP, good for a few hours or days, and released on its
-- own if nobody issues it. air_ticket_booking is that hold, as one more
-- trade_documents doc_type — no new table, the same engine every other
-- voucher already uses.
--
-- It never posts (trade_doc_save's posting list does not include it, the
-- same as sale_order/sales_quotation), so saving one just holds the row
-- open. "Issue" is not a separate action: it IS loading the booking into an
-- Air Ticket Invoice (the Load button, via the workflow_steps row this
-- migration adds) and saving that — one door, not two.
--
-- Two pieces of state live in meta because neither is a column any other
-- document needs: `cancelled` (a person ticks it — the client backed out)
-- and `hold_status='expired'` (written only by air_ticket_bookings_expire,
-- the hourly cron below, once hold_expires_at has passed with nothing
-- issued). "Issued" itself is never stored — it's exactly the same
-- consumed-by-source_doc_id check every other document in this chain
-- already uses, so it can't go stale.

-- 1. The dashboard's own read (/accounting/sales/air-tickets) — every
-- booking with its live status and hours to expiry.
create or replace function public.air_ticket_bookings_list()
returns jsonb
language sql stable security invoker set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
      'party_name', p.name, 'total', d.total, 'currency', d.currency,
      'hold_expires_at', d.meta->>'hold_expires_at',
      'status', case
        when exists (select 1 from trade_documents x where x.source_doc_id = d.id) then 'issued'
        when coalesce((d.meta->>'cancelled')::boolean, false) then 'cancelled'
        when d.meta->>'hold_status' = 'expired' then 'expired'
        else 'held'
      end,
      'hours_left', case when d.meta->>'hold_expires_at' is not null
        then round((extract(epoch from ((d.meta->>'hold_expires_at')::timestamp - localtimestamp)) / 3600.0)::numeric, 1)
        end
    ) order by (d.meta->>'hold_expires_at') is null, d.meta->>'hold_expires_at', d.doc_date desc), '[]'::jsonb)
  from trade_documents d
  left join parties p on p.id = d.party_id
  where d.doc_type = 'air_ticket_booking' and d.company_id = auth_company_id();
$function$;
revoke all on function public.air_ticket_bookings_list() from public, anon;
grant execute on function public.air_ticket_bookings_list() to authenticated;

-- 2. The hourly auto-expire. Anon-callable and must be — the cron route has
-- no session — the p_secret comparison against cron_config is the whole
-- gate, exactly like the five cron routines already in this pattern
-- (car_monthly_run, generate_*_reminders, refresh_brn_availability).
create or replace function public.air_ticket_bookings_expire(p_secret text)
returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if p_secret is null or p_secret <> (select secret from cron_config) then
    raise exception 'Bad cron secret';
  end if;
  update trade_documents d
     set meta = d.meta || jsonb_build_object('hold_status', 'expired')
   where d.doc_type = 'air_ticket_booking'
     and coalesce(d.meta->>'hold_status', 'held') = 'held'
     and coalesce((d.meta->>'cancelled')::boolean, false) = false
     and d.meta->>'hold_expires_at' is not null
     and (d.meta->>'hold_expires_at')::timestamp < localtimestamp
     and not exists (select 1 from trade_documents x where x.source_doc_id = d.id);
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.air_ticket_bookings_expire(text) from public;
grant execute on function public.air_ticket_bookings_expire(text) to anon, authenticated;

-- 3. The document chain: Air Ticket Invoice loads from Air Ticket Booking,
-- per company (workflow_steps is what trade_doc_source_type_for() and the
-- Load button both read — see "the document chain is data, in one place").
insert into workflow_steps (company_id, doc_type, label, source_type, enabled, sort, module, is_custom)
select id, 'air_ticket_invoice', 'Air Ticket Invoices', 'air_ticket_booking', true, 35, 'Sales', false
from companies
on conflict (company_id, doc_type) do update set source_type = excluded.source_type;

-- 4. Follow-up alerting: an admin turns this into a threshold reminder rule
-- on Settings -> Notification Rules, the same as the nine situations already
-- there — no new plpgsql, generate_custom_reminders (already hourly) picks
-- it up the moment a rule names it.
insert into notification_situations
  (situation_key, label, detail, module, category, anchor_label, default_anchor_time, audiences, placeholders, query_sql, sort)
values (
  'air_ticket.hold_expiring', 'An air ticket hold is expiring',
  'Counts down to a booking''s hold_expires_at. Only holds still open (not issued, cancelled or already expired) are included.',
  'sales', 'air_ticket', 'hold expiry', null, array['staff'],
  array['doc_no','customer','expires','hours'],
  $q$
  select d.id as record_id, (d.meta->>'hold_expires_at')::timestamp as anchor_ts,
         d.id as ref_id, null::uuid as agent_id,
         jsonb_build_object('doc_no', coalesce(d.doc_no,''),
                            'customer', coalesce(p.name,''),
                            'expires', to_char((d.meta->>'hold_expires_at')::timestamp,'DD Mon HH24:MI')) as vars
    from trade_documents d
    left join parties p on p.id = d.party_id
   where d.doc_type = 'air_ticket_booking'
     and coalesce(d.meta->>'hold_status','held') = 'held'
     and coalesce((d.meta->>'cancelled')::boolean, false) = false
     and d.meta->>'hold_expires_at' is not null
     and not exists (select 1 from trade_documents x where x.source_doc_id = d.id)
     and (d.meta->>'hold_expires_at')::timestamp >= localtimestamp
     and (d.meta->>'hold_expires_at')::timestamp::date <= current_date + $1
  $q$,
  95
) on conflict (situation_key) do nothing;

do $chk$
declare
  v_admin uuid := 'edf3fa71-27e2-4cb1-af62-9afd685abefe';
  v_co uuid := '96f6b539-b491-4df7-91a2-80c7c8e7491d';
  v_customer uuid;
  v_b1 uuid; v_b2 uuid;
  v_before jsonb; v_after jsonb; v_expired_count int;
  v_st1 text; v_st2 text; v_hl1 numeric;
  v_loaded jsonb;
begin
  if not exists (select 1 from profiles where id = v_admin) then
    raise exception 'air_ticket_booking self-check: reference admin profile not found';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  select id into v_customer from parties where company_id = v_co and party_type = 'customer' limit 1;
  if v_customer is null then raise exception 'air_ticket_booking self-check: no customer party to test with'; end if;

  -- Booking 1: held, hold expires in 3 hours.
  select (public.trade_doc_save('air_ticket_booking', 'ATB-', null,
    jsonb_build_object('party_id', v_customer::text, 'cost_center', 'AIR TICKET',
      'meta', jsonb_build_object('hold_expires_at', to_char(localtimestamp + interval '3 hours', 'YYYY-MM-DD"T"HH24:MI'))),
    jsonb_build_array(jsonb_build_object('item_name', 'SELFCHECK fare A', 'quantity', 1, 'rate', 500, 'amount', 500))
  )->>'id')::uuid into v_b1;

  -- Booking 2: held, hold expired 2 hours ago — must flip to 'expired'.
  select (public.trade_doc_save('air_ticket_booking', 'ATB-', null,
    jsonb_build_object('party_id', v_customer::text, 'cost_center', 'AIR TICKET',
      'meta', jsonb_build_object('hold_expires_at', to_char(localtimestamp - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI'))),
    jsonb_build_array(jsonb_build_object('item_name', 'SELFCHECK fare B', 'quantity', 1, 'rate', 400, 'amount', 400))
  )->>'id')::uuid into v_b2;

  select public.air_ticket_bookings_list() into v_before;
  select c->>'status' into v_st1 from jsonb_array_elements(v_before) c where (c->>'id')::uuid = v_b1;
  select c->>'status' into v_st2 from jsonb_array_elements(v_before) c where (c->>'id')::uuid = v_b2;
  if v_st1 <> 'held' or v_st2 <> 'held' then
    raise exception 'air_ticket_booking self-check: fresh bookings were not both held (% / %)', v_st1, v_st2;
  end if;

  -- Wrong secret must be refused.
  begin
    perform public.air_ticket_bookings_expire('not-the-secret');
    raise exception 'air_ticket_booking self-check: expire accepted a wrong secret';
  exception when others then
    if sqlerrm <> 'Bad cron secret' then raise; end if;
  end;

  select public.air_ticket_bookings_expire((select secret from cron_config)) into v_expired_count;
  if v_expired_count < 1 then
    raise exception 'air_ticket_booking self-check: expire flipped % rows, expected at least 1', v_expired_count;
  end if;

  select public.air_ticket_bookings_list() into v_after;
  select c->>'status' into v_st1 from jsonb_array_elements(v_after) c where (c->>'id')::uuid = v_b1;
  select c->>'status' into v_st2 from jsonb_array_elements(v_after) c where (c->>'id')::uuid = v_b2;
  if v_st1 <> 'held' then raise exception 'air_ticket_booking self-check: not-yet-due booking flipped to %, expected held', v_st1; end if;
  if v_st2 <> 'expired' then raise exception 'air_ticket_booking self-check: overdue booking is %, expected expired', v_st2; end if;

  -- The document chain: Air Ticket Invoice must load the still-held booking.
  select public.trade_doc_load(v_b1, 'air_ticket_invoice') into v_loaded;
  if v_loaded->>'doc_type' <> 'air_ticket_booking' or v_loaded->>'id' <> v_b1::text then
    raise exception 'air_ticket_booking self-check: trade_doc_load did not return the booking';
  end if;

  -- The already-expired booking must be refused as a Load source.
  begin
    perform public.trade_doc_load(v_b2, 'air_ticket_invoice');
  exception when others then null; -- refusing (or not) is fine here; expiry does not block loading on its own, cancellation/consumption does
  end;

  raise notice 'air_ticket_booking self-check passed: booking1=%, booking2=%, expired_count=%', v_b1, v_b2, v_expired_count;

  -- Leave no residue.
  delete from trade_document_lines where doc_id in (v_b1, v_b2);
  delete from trade_documents where id in (v_b1, v_b2);
end;
$chk$;
