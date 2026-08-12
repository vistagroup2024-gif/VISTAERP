-- 166 Multi-stay hotel bookings (Phase 2) + per-stay HCN workflow RPCs (Phase 3).
--
-- A booking can now hold multiple independent hotel stays. Each stay is a row in
-- hotel_purchase_bookings (already the per-vendor child, already carries the HCN
-- workflow) extended with the sell side: sale_rate, sale_total, meal_plan, city,
-- sort. hotel_bookings stays the header and is rolled up from the stays: grand
-- sale_total = sum of stay sale_totals; the header hotel/dates/rooms mirror the
-- primary (lowest-sort) stay so the list, voucher, reports and agent portal keep
-- working unchanged.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

-- 1. Sell-side + ordering columns on the per-stay table.
alter table hotel_purchase_bookings add column if not exists sale_rate  numeric not null default 0;
alter table hotel_purchase_bookings add column if not exists sale_total numeric not null default 0;
alter table hotel_purchase_bookings add column if not exists meal_plan  text;
alter table hotel_purchase_bookings add column if not exists city       city_type;
alter table hotel_purchase_bookings add column if not exists sort       integer not null default 0;

-- 2. Backfill: every existing booking becomes at least one stay carrying its sale.
insert into hotel_purchase_bookings(company_id, booking_id, hotel_id, hotel_name, room_type,
       check_in, check_out, rooms, sale_rate, sale_total, meal_plan, city, sort)
select b.company_id, b.id, b.hotel_id, b.hotel_name, b.room_type,
       b.check_in, b.check_out, b.rooms, b.sale_rate, b.sale_total, b.meal_plan, b.city, 0
from hotel_bookings b
where not exists (select 1 from hotel_purchase_bookings s where s.booking_id = b.id);

-- Bookings that already had a purchase row: copy the header sale onto the earliest stay.
update hotel_purchase_bookings s set
  sale_rate  = case when s.sale_rate  = 0 then b.sale_rate  else s.sale_rate  end,
  sale_total = case when s.sale_total = 0 then b.sale_total else s.sale_total end,
  meal_plan  = coalesce(s.meal_plan, b.meal_plan),
  city       = coalesce(s.city, b.city)
from hotel_bookings b
where s.booking_id = b.id
  and s.id = (select s2.id from hotel_purchase_bookings s2 where s2.booking_id = b.id order by s2.sort, s2.created_at limit 1);

-- 3. Roll the stays up onto the booking header.
create or replace function public.hotel_booking_rollup(p_booking uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare ps hotel_purchase_bookings;
begin
  select * into ps from hotel_purchase_bookings where booking_id = p_booking order by sort, created_at limit 1;
  if ps.id is null then
    update hotel_bookings set sale_total = 0 where id = p_booking and company_id = auth_company_id();
    return;
  end if;
  update hotel_bookings b set
    sale_total = coalesce((select sum(sale_total) from hotel_purchase_bookings where booking_id = p_booking), 0),
    sale_rate  = ps.sale_rate,
    hotel_id   = ps.hotel_id,
    hotel_name = ps.hotel_name,
    city       = coalesce(ps.city, b.city),
    check_in   = ps.check_in,
    check_out  = ps.check_out,
    rooms      = coalesce((select sum(rooms) from hotel_purchase_bookings where booking_id = p_booking), b.rooms),
    room_type  = ps.room_type,
    meal_plan  = ps.meal_plan
  where b.id = p_booking and b.company_id = auth_company_id();
end $$;

-- 4. Save the whole booking (header + stays) in one call.
create or replace function public.hotel_booking_save_full(p_id uuid, p jsonb, p_stays jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_id uuid; v_no text; s jsonb; v_sid uuid; v_keep uuid[] := '{}';
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
        sort          = coalesce(nullif(s->>'sort','')::int, 0)
      where id = v_sid and booking_id = v_id and company_id = v_company;
    else
      insert into hotel_purchase_bookings(company_id, booking_id, supplier_id, hotel_id, hotel_name, city,
        room_type, meal_plan, check_in, check_out, rooms, sale_rate, sale_total,
        purchase_rate, purchase_total, currency, supplier_ref, notes, sort)
      values (v_company, v_id, nullif(s->>'supplier_id','')::uuid, nullif(s->>'hotel_id','')::uuid, s->>'hotel_name',
        nullif(s->>'city','')::city_type, s->>'room_type', s->>'meal_plan',
        nullif(s->>'check_in','')::date, nullif(s->>'check_out','')::date,
        coalesce(nullif(s->>'rooms','')::int, 1),
        coalesce(nullif(s->>'sale_rate','')::numeric, 0), coalesce(nullif(s->>'sale_total','')::numeric, 0),
        coalesce(nullif(s->>'purchase_rate','')::numeric, 0), coalesce(nullif(s->>'purchase_total','')::numeric, 0),
        coalesce(nullif(s->>'currency',''), 'SAR'), s->>'supplier_ref', s->>'notes',
        coalesce(nullif(s->>'sort','')::int, 0))
      returning id into v_sid;
    end if;
    v_keep := array_append(v_keep, v_sid);
  end loop;

  delete from hotel_purchase_bookings
  where booking_id = v_id and company_id = v_company and not (id = any(v_keep));

  perform hotel_booking_rollup(v_id);
  perform hotel_log(v_id, case when p_id is null then 'hotel_booking_create' else 'hotel_booking_update' end, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function public.hotel_booking_save_full(uuid, jsonb, jsonb) from anon;

-- 5. Delete a single stay and re-roll the header.
create or replace function public.hotel_stay_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_booking uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  delete from hotel_purchase_bookings where id = p_id and company_id = auth_company_id()
    returning booking_id into v_booking;
  if v_booking is not null then perform hotel_booking_rollup(v_booking); end if;
end $$;
revoke all on function public.hotel_stay_delete(uuid) from anon;

-- 6. Extend the per-stay purchase save to persist the sell side + re-roll.
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
    hotel_id      = nullif(p->>'hotel_id','')::uuid,
    hotel_name    = p->>'hotel_name',
    city          = nullif(p->>'city','')::city_type,
    room_type     = p->>'room_type',
    meal_plan     = p->>'meal_plan',
    check_in      = nullif(p->>'check_in','')::date,
    check_out     = nullif(p->>'check_out','')::date,
    rooms         = coalesce(nullif(p->>'rooms','')::int, 1),
    sale_rate     = coalesce(nullif(p->>'sale_rate','')::numeric, sale_rate),
    sale_total    = coalesce(nullif(p->>'sale_total','')::numeric, sale_total),
    purchase_rate = coalesce(nullif(p->>'purchase_rate','')::numeric, 0),
    purchase_total= coalesce(nullif(p->>'purchase_total','')::numeric, 0),
    currency      = coalesce(nullif(p->>'currency',''), 'SAR'),
    supplier_ref  = p->>'supplier_ref',
    notes         = p->>'notes',
    sort          = coalesce(nullif(p->>'sort','')::int, sort)
  where id = v_id and company_id = v_company;

  perform hotel_booking_rollup(p_booking);
  perform hotel_log(p_booking, 'hotel_purchase_save', '{}'::jsonb);
  return v_id;
end $$;
revoke all on function public.hotel_purchase_save(uuid, uuid, jsonb) from anon;

-- 7. Phase 3 — per-stay HCN workflow.
-- Waiting HCN (pending) -> Received HCN, number entered (ready_to_send) -> HCN Sent (sent).
create or replace function public.hotel_hcn_set_number(p_id uuid, p_hcn text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_booking uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(btrim(p_hcn),'') = '' then raise exception 'HCN number is required'; end if;
  update hotel_purchase_bookings set
    hcn = p_hcn, hcn_received_date = coalesce(hcn_received_date, current_date),
    hcn_status = 'ready_to_send', vendor_status = 'hcn_received'
  where id = p_id and company_id = v_company returning booking_id into v_booking;
  if v_booking is null then raise exception 'Stay not found'; end if;
  update hotel_bookings set status = 'hcn_received' where id = v_booking and status not in ('completed','cancelled');
  perform hotel_log(v_booking, 'hotel_hcn_received', jsonb_build_object('hcn', p_hcn));
end $$;
revoke all on function public.hotel_hcn_set_number(uuid, text) from anon;

create or replace function public.hotel_hcn_mark_sent(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_booking uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update hotel_purchase_bookings set
    hcn_status = 'sent', hcn_shared = true, hcn_shared_at = now(),
    hcn_shared_by = coalesce((select full_name from profiles where id = auth.uid()), 'Staff')
  where id = p_id and company_id = v_company and hcn is not null returning booking_id into v_booking;
  if v_booking is null then raise exception 'Enter the HCN number before marking it sent'; end if;
  perform hotel_log(v_booking, 'hotel_hcn_sent', '{}'::jsonb);
end $$;
revoke all on function public.hotel_hcn_mark_sent(uuid) from anon;
