-- Arrival Service in two categories, and Driver Tafweej Details.
--
-- WHAT THE SCREEN SHOWED AND WHY IT WAS HALF THE PICTURE. /transport/arrivals
-- listed umrah_groups — the visa groups Vista issued — that still had no
-- transport booking or tafweej. That is one of two ways a pilgrim arrives on
-- Vista's transport. The other is an agent who got the visa elsewhere and
-- booked ONLY the transport with Vista: 339 of the 434 bookings ever taken are
-- that kind, and none of them appeared, because they are not umrah_groups.
--
-- So the screen becomes two categories, each answering its own question:
--
--   VISA BY VISTA       the umrah_groups list as before, now carrying the visa
--                       company (group_companies, via group_company_id) as a
--                       column — Vista arranges the tafweej for these.
--   TRANSPORT BY VISTA  the arrival trips of bookings that match NO Vista visa
--                       group. No group number and no visa company, because
--                       there is neither: the agent got the visa elsewhere and
--                       must create the tafweej THERE, with the driver Vista
--                       assigned. What they need from Vista is the driver's
--                       details in the form the tafweej asks for.
--
-- THAT FORM IS ONE DEFINITION, SHOWN TWICE. trip_tafweej_details() builds it:
--
--   Driver Tafweej Details :
--
--   Company Name: 🏢
--   VISTA GROUP COMPANY
--
--   Driver Name: 👨‍✈️
--   Qaiser Khan
--
--   Reg No.: 🔢 7022 - أ ص س
--
-- Staff read it through transport_trip_tafweej (Arrival Service, the
-- operations board), the agent through b2b_trip_tafweej (their booking's
-- Tafweej page), and neither shapes the text itself — the same rule this
-- project applies to the agent fare chart. The company name is ALWAYS the
-- tafweej_company_name setting, in-house driver or vendor alike: the tafweej
-- is issued against Vista, whoever is driving.
--
-- WHERE THE REGISTRATION COMES FROM. transport_vehicles are TYPES (Staria,
-- Starex), not units, so the plate has always lived on the driver row — in
-- `license_no`, which actually holds plates like ATA-4086 and is labelled
-- "Registration No." on the Drivers screen. A tafweej wants the plate as the
-- authority writes it, digits then Arabic letters, so the driver row gains
-- `tafweej_reg` for exactly that string, falling back to license_no until it
-- is filled in. A vendor's driver is not in the drivers master at all, so the
-- trip carries `outsource_driver_reg` beside the outsourced name and mobile,
-- entered in the same dialog that assigns the vendor.
--
-- THE AGENT IS TOLD. transport_confirm_assignments already sends "Drivers
-- assigned" when the day's assignments are confirmed. For a transport-only
-- booking it now ALSO sends "Create Tafweej — <booking no>", deep-linked to
-- that booking's Tafweej page, because "drivers assigned" does not say that
-- there is something the agent has to go and do. It is a notification rule
-- like the others (transport.tafweej_agent), so it can be reworded or turned
-- off on Notification Rules.
--
-- The agent sees the driver only once the assignment is CONFIRMED, exactly as
-- their schedule already works; staff see it as soon as it is assigned.

begin;

-- ---------------------------------------------------------------------------
-- 1. Where the registration lives.
-- ---------------------------------------------------------------------------
alter table transport_drivers add column if not exists tafweej_reg text;
alter table transport_trips   add column if not exists outsource_driver_reg text;

comment on column transport_drivers.tafweej_reg is
  'Registration as the tafweej writes it — digits then Arabic letters, e.g. "7022 - أ ص س". Falls back to license_no (which holds the plate) when empty.';
comment on column transport_trips.outsource_driver_reg is
  'Registration of a vendor''s driver for the tafweej, entered when the vendor is assigned. Vendor drivers are not in transport_drivers.';

insert into erp_settings(key, value)
select 'tafweej_company_name', 'VISTA GROUP COMPANY'
 where not exists (select 1 from erp_settings where key = 'tafweej_company_name');

-- ---------------------------------------------------------------------------
-- 2. Does this booking belong to a visa Vista issued? One definition, used by
--    the Transport-by-Vista list and by the confirmation notification.
-- ---------------------------------------------------------------------------
create or replace function public.booking_has_vista_visa(p_booking uuid)
returns boolean
language sql stable
set search_path to 'public'
as $function$
  select exists (
    select 1
      from transport_bookings b
      join umrah_groups g on g.company_id = b.company_id
     where b.id = p_booking
       and b.nusuk_group_no is not null and g.group_no is not null
       and coalesce(g.workflow_status, 'pending') <> 'rejected'
       and exists (
         select 1 from unnest(regexp_split_to_array(b.nusuk_group_no, '[,;/[:space:]]+')) tok
          where btrim(tok) <> '' and btrim(tok) = btrim(g.group_no))
  );
$function$;
revoke all on function public.booking_has_vista_visa(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The Tafweej details — the one place the text is built.
-- ---------------------------------------------------------------------------
create or replace function public.trip_tafweej_details(p_trip uuid, p_require_confirmed boolean default false)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare
  t   transport_trips%rowtype;
  dr  transport_drivers%rowtype;
  v_company text;
  v_name    text;
  v_reg     text;
  v_ready   boolean;
  v_text    text;
begin
  select * into t from transport_trips where id = p_trip;
  if not found then return null; end if;

  v_company := coalesce((select value from erp_settings where key = 'tafweej_company_name'),
                        'VISTA GROUP COMPANY');

  if t.driver_id is not null then
    select * into dr from transport_drivers where id = t.driver_id;
    v_name := dr.name;
    v_reg  := coalesce(nullif(btrim(dr.tafweej_reg), ''), nullif(btrim(dr.license_no), ''));
  else
    v_name := nullif(btrim(coalesce(t.outsource_driver_name, '')), '');
    v_reg  := nullif(btrim(coalesce(t.outsource_driver_reg, '')), '');
  end if;

  v_ready := v_name is not null
             and (not p_require_confirmed or coalesce(t.assignment_confirmed, false));

  if v_ready then
    v_text := 'Driver Tafweej Details :' || E'\n\n'
           || 'Company Name: 🏢' || E'\n' || v_company || E'\n\n'
           || 'Driver Name: 👨‍✈️' || E'\n' || v_name || E'\n\n'
           || 'Reg No.: 🔢 ' || coalesce(v_reg, '—');
  end if;

  return jsonb_build_object(
    'trip_id', t.id, 'booking_id', t.booking_id,
    'company', v_company,
    'driver_name', case when v_ready then v_name end,
    'reg_no',      case when v_ready then v_reg end,
    'reg_missing', v_ready and v_reg is null,
    'is_vendor',   t.driver_id is null and t.vendor_id is not null,
    'confirmed',   coalesce(t.assignment_confirmed, false),
    'tafweej_created', coalesce(t.tafweej_created, false),
    'ready', v_ready,
    'text', v_text);
end $function$;
revoke all on function public.trip_tafweej_details(uuid, boolean) from public, anon, authenticated;

-- Staff door: any assigned driver, confirmed or not.
create or replace function public.transport_trip_tafweej(p_trip uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from transport_trips where id = p_trip and company_id = auth_company_id()) then
    raise exception 'Trip not found';
  end if;
  return trip_tafweej_details(p_trip, false);
end $function$;
revoke all on function public.transport_trip_tafweej(uuid) from public, anon;
grant execute on function public.transport_trip_tafweej(uuid) to authenticated;

-- Agent door: their own booking, and only once the assignment is confirmed —
-- the same moment their schedule starts showing the driver.
create or replace function public.b2b_trip_tafweej(p_token text, p_trip uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  if a.id is null then raise exception 'Not signed in'; end if;
  if not exists (
    select 1 from transport_trips t join transport_bookings b on b.id = t.booking_id
     where t.id = p_trip and b.company_id = a.company_id
       and b.agent_id = coalesce(a.agent_party_id, a.id)) then
    return null;
  end if;
  return trip_tafweej_details(p_trip, true);
end $function$;
grant execute on function public.b2b_trip_tafweej(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The two lists.
-- ---------------------------------------------------------------------------
drop function if exists public.arrival_compliance(integer);
create function public.arrival_compliance(p_days integer default 30)
returns table(id uuid, group_no text, group_name text, arrival_date date, pax integer,
              agency text, visa_company text, arrival_service text, days_to_arrival integer)
language sql stable security definer
set search_path to 'public'
as $function$
  select g.id, g.group_no, g.group_name, g.arrival_date, g.pax,
         coalesce(a.agency_name, p.name) as agency,
         gc.name as visa_company,
         g.arrival_service,
         (g.arrival_date - current_date) as days_to_arrival
    from umrah_groups g
    left join b2b_agents a on a.agent_party_id = g.agent_id
    left join parties p on p.id = g.agent_id
    left join group_companies gc on gc.id = g.group_company_id
   where g.company_id = auth_company_id()
     and coalesce(g.workflow_status,'pending') <> 'rejected'
     and g.arrival_date is not null and g.arrival_date >= current_date
     and g.arrival_date <= current_date + p_days
     and arrival_service_state(g.id) = 'pending'
   order by g.arrival_date;
$function$;
revoke all on function public.arrival_compliance(integer) from public, anon;
grant execute on function public.arrival_compliance(integer) to authenticated;

-- Arrival trips of bookings that match no Vista visa group. An arrival is a
-- trip leaving an airport — the same test the agent schedule uses.
create or replace function public.arrival_transport_by_vista(p_days integer default 30)
returns table(trip_id uuid, booking_id uuid, booking_no text, passenger_name text, agency text,
              trip_date date, trip_time time, flight_no text, route text, pax integer,
              driver_name text, vendor_name text, assignment_confirmed boolean,
              tafweej_created boolean, tafweej_ready boolean, days_to_arrival integer)
language sql stable security definer
set search_path to 'public'
as $function$
  select ts.id, b.id, b.booking_no, b.passenger_name,
         coalesce(a.agency_name, p.name) as agency,
         ts.trip_date, ts.trip_time, ts.flight_no,
         coalesce(ts.route_name, ts.route_label) as route,
         coalesce(t.pax, b.pax) as pax,
         coalesce(dr.name, t.outsource_driver_name) as driver_name,
         vn.name as vendor_name,
         coalesce(t.assignment_confirmed, false),
         coalesce(t.tafweej_created, false),
         (coalesce(dr.name, t.outsource_driver_name) is not null) as tafweej_ready,
         (ts.trip_date - current_date) as days_to_arrival
    from transport_trip_sched ts
    join transport_bookings b on b.id = ts.booking_id
    join transport_trips t on t.id = ts.id
    left join transport_drivers dr on dr.id = t.driver_id
    left join transport_vendors vn on vn.id = t.vendor_id
    left join b2b_agents a on a.agent_party_id = b.agent_id or a.id = b.agent_id
    left join parties p on p.id = b.agent_id
   where b.company_id = auth_company_id()
     and b.status <> 'cancelled'
     and ts.status not in ('cancelled', 'completed')
     and ts.trip_date >= current_date and ts.trip_date <= current_date + p_days
     and (coalesce(ts.route_name, '') ilike '%airport -%' or coalesce(ts.pickup_location, '') ilike '%airport%')
     and not booking_has_vista_visa(b.id)
   order by ts.trip_date, ts.trip_time nulls last, b.booking_no;
$function$;
revoke all on function public.arrival_transport_by_vista(integer) from public, anon;
grant execute on function public.arrival_transport_by_vista(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The vendor dialog takes the registration. There were THREE overloads of
--    this routine — two, four and five arguments — and nothing called the first
--    two: no database routine references it and the operations board is the one
--    caller, naming five arguments. They are dead code, and worse than dead
--    beside a six-argument version whose extras all default: a call naming two
--    arguments would match both and PostgREST refuses an ambiguous call. So
--    all three go and one definition stays. The first apply of this migration
--    stopped on exactly this — it expected two overloads to remain and found
--    three — which is the check earning its keep.
-- ---------------------------------------------------------------------------
drop function if exists public.transport_assign_vendor(uuid, uuid);
drop function if exists public.transport_assign_vendor(uuid, uuid, text, text);
drop function if exists public.transport_assign_vendor(uuid, uuid, text, text, numeric);
create function public.transport_assign_vendor(
  p_trip uuid, p_vendor uuid,
  p_driver_name text default null, p_driver_mobile text default null,
  p_vendor_cost numeric default null, p_driver_reg text default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v transport_vendors%rowtype; t transport_trips%rowtype;
  v_name text; v_mobile text; v_req uuid; v_reqrank int; v_best uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into v from transport_vendors where id = p_vendor and company_id = auth_company_id();
  if not found then raise exception 'Vendor not found'; end if;
  select * into t from transport_trips where id = p_trip and company_id = auth_company_id();
  if not found then raise exception 'Trip not found'; end if;

  v_req := coalesce(t.requested_vehicle_id, t.vehicle_id);
  v_reqrank := coalesce((select upgrade_rank from transport_vehicles where id = v_req), 0);

  if v.vehicle_ids is null or array_length(v.vehicle_ids, 1) is null then
    v_best := v_req;
  elsif v_req is not null and v_req = any(v.vehicle_ids) then
    v_best := v_req;
  else
    select ve.id into v_best from transport_vehicles ve
      where ve.id = any(v.vehicle_ids) and coalesce(ve.upgrade_rank, 0) >= v_reqrank
      order by coalesce(ve.upgrade_rank, 0) asc, ve.name limit 1;
    if v_best is null then
      raise exception 'Vendor % does not operate a vehicle of the required category or higher.', v.name;
    end if;
  end if;

  if v.vendor_type = 'vendor_driver' then v_name := coalesce(nullif(v.contact_person,''), v.name); v_mobile := v.mobile;
  else v_name := nullif(p_driver_name,''); v_mobile := nullif(p_driver_mobile,''); end if;

  update transport_trips set vendor_id = p_vendor, outsource_driver_name = v_name,
    outsource_driver_mobile = v_mobile, outsource_driver_reg = nullif(btrim(coalesce(p_driver_reg, '')), ''),
    vendor_cost = p_vendor_cost, status = 'assigned', assigned_at = now(),
    driver_id = null, scheduled_start = null, scheduled_end = null,
    requested_vehicle_id = coalesce(requested_vehicle_id, vehicle_id),
    vehicle_id = coalesce(v_best, vehicle_id),
    is_upgraded = (v_best is distinct from v_req)
  where id = p_trip and company_id = auth_company_id()
    and status in ('pending','outsource_required','outsourced','assigned','on_route');
  if not found then raise exception 'Trip not found or cannot be outsourced in its current status.'; end if;
end $function$;
revoke all on function public.transport_assign_vendor(uuid, uuid, text, text, numeric, text) from public, anon;
grant execute on function public.transport_assign_vendor(uuid, uuid, text, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Confirming the day tells a transport-only agent to create the tafweej.
-- ---------------------------------------------------------------------------
insert into notification_rules(rule_key, label, module, category, audience, enabled, thresholds,
  anchor_label, title, titles, body, placeholders, kind, match_title, system_rule, sends_ref)
select 'transport.tafweej_agent', 'Create Tafweej (to the agent — transport-only bookings)',
       'transport', 'transport', 'agent', true, '{}',
       'staff confirming the day''s driver assignments',
       'Create Tafweej — {ref}', '{}'::jsonb, '{default}', array['default','ref'],
       'event', 'Create Tafweej', true, true
 where not exists (select 1 from notification_rules where rule_key = 'transport.tafweej_agent');

create or replace function public.transport_confirm_assignments(p_date date)
returns integer
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_n int := 0; r record; v_agent uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  create temp table if not exists _confirmed_bk(booking_id uuid) on commit drop;
  truncate _confirmed_bk;
  with flipped as (
    update transport_trips t set assignment_confirmed = true
    from transport_trip_sched ts join transport_bookings b on b.id = ts.booking_id
    where t.id = ts.id and ts.company_id = v_company and ts.trip_date = p_date
      and b.status <> 'cancelled' and t.assignment_confirmed = false
      and (t.driver_id is not null or t.vendor_id is not null or t.status in ('assigned','outsourced'))
    returning ts.booking_id
  )
  insert into _confirmed_bk select distinct booking_id from flipped;
  get diagnostics v_n = row_count;

  -- One "Drivers assigned" per agent for the day, as before.
  for r in
    select distinct b.agent_id from transport_bookings b
    where b.id in (select booking_id from _confirmed_bk) and b.agent_id is not null
  loop
    select id into v_agent from b2b_agents where agent_party_id = r.agent_id or id = r.agent_id limit 1;
    if v_agent is not null then
      perform push_notification('agent', v_agent, 'transport',
        'Drivers assigned', 'Driver assignments for ' || to_char(p_date,'DD Mon') || ' are confirmed. You can view and copy driver details in your schedule.',
        'transport', null);
    end if;
  end loop;

  -- And, per TRANSPORT-ONLY booking — the visa is not Vista's, so the tafweej
  -- is the agent's to create — a "Create Tafweej" that lands on that booking's
  -- Tafweej page, where the driver details are in the form the tafweej wants.
  for r in
    select b.id, b.booking_no, b.agent_id from transport_bookings b
    where b.id in (select booking_id from _confirmed_bk) and b.agent_id is not null
      and not booking_has_vista_visa(b.id)
  loop
    select id into v_agent from b2b_agents where agent_party_id = r.agent_id or id = r.agent_id limit 1;
    if v_agent is not null then
      perform push_notification('agent', v_agent, 'transport',
        'Create Tafweej — ' || coalesce(r.booking_no, ''),
        'The driver for ' || to_char(p_date,'DD Mon') || ' is confirmed. Create the Tafweej where the visa was issued — open this to view and copy the driver details.',
        'transport', r.id, '/agent/module/transport/' || r.id || '/tafweej');
    end if;
  end loop;

  return v_n;
end $function$;

-- ---------------------------------------------------------------------------
-- 7. Post-conditions — exercised, not just declared.
-- ---------------------------------------------------------------------------
do $chk$
declare
  r jsonb; v_n int; v_trip uuid; v_def text;
begin
  if not exists (select 1 from pg_attribute where attrelid='public.transport_drivers'::regclass and attname='tafweej_reg' and not attisdropped) then
    raise exception '373: transport_drivers.tafweej_reg missing'; end if;
  if not exists (select 1 from pg_attribute where attrelid='public.transport_trips'::regclass and attname='outsource_driver_reg' and not attisdropped) then
    raise exception '373: transport_trips.outsource_driver_reg missing'; end if;
  if (select value from erp_settings where key='tafweej_company_name') <> 'VISTA GROUP COMPANY' then
    raise exception '373: tafweej_company_name setting missing'; end if;

  -- the text, on a real trip that has an in-house driver
  select t.id into v_trip from transport_trips t join transport_drivers d on d.id = t.driver_id
   order by t.created_at desc limit 1;
  if v_trip is not null then
    r := trip_tafweej_details(v_trip, false);
    if not (r->>'ready')::boolean then raise exception '373: a trip with a driver is not ready: %', r; end if;
    if r->>'text' !~ '^Driver Tafweej Details :' then raise exception '373: text does not open with the heading: %', r->>'text'; end if;
    if r->>'text' !~ 'Company Name: 🏢\nVISTA GROUP COMPANY' then raise exception '373: company block wrong: %', r->>'text'; end if;
    if r->>'text' !~ 'Driver Name: 👨‍✈️\n' then raise exception '373: driver block wrong: %', r->>'text'; end if;
    if r->>'text' !~ 'Reg No\.: 🔢 ' then raise exception '373: reg block wrong: %', r->>'text'; end if;
    -- the fallback: no tafweej_reg yet, so the plate in license_no must be used
    if (select tafweej_reg from transport_drivers where id = (select driver_id from transport_trips where id = v_trip)) is null
       and (select license_no from transport_drivers where id = (select driver_id from transport_trips where id = v_trip)) is not null
       and r->>'reg_no' is null then
      raise exception '373: license_no fallback not applied: %', r;
    end if;
  else
    raise notice '373: no trip with an in-house driver to exercise the text on';
  end if;

  -- a trip with no driver at all is not ready and carries no text
  select id into v_trip from transport_trips where driver_id is null and outsource_driver_name is null limit 1;
  if v_trip is not null then
    r := trip_tafweej_details(v_trip, false);
    if (r->>'ready')::boolean or r->>'text' is not null then raise exception '373: an unassigned trip reads as ready: %', r; end if;
  end if;

  -- the two arrival lists run as a staff user
  perform set_config('request.jwt.claims',
    '{"sub":"edf3fa71-27e2-4cb1-af62-9afd685abefe","role":"authenticated"}', true);
  if not is_staff() then raise exception '373: could not act as staff for the list checks'; end if;
  perform * from arrival_compliance(365);
  perform * from arrival_transport_by_vista(365);
  -- nothing in the transport list may match a Vista visa group
  select count(*) into v_n from arrival_transport_by_vista(3650) x where booking_has_vista_visa(x.booking_id);
  if v_n <> 0 then raise exception '373: % Transport-by-Vista row(s) actually have a Vista visa', v_n; end if;
  -- and the visa list carries the new column
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='arrival_compliance'
                    and pg_get_function_result(p.oid) like '%visa_company text%') then
    raise exception '373: arrival_compliance has no visa_company column'; end if;

  -- exactly ONE transport_assign_vendor, the six-argument one, so no call can be ambiguous
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='transport_assign_vendor';
  if v_n <> 1 then raise exception '373: % transport_assign_vendor overload(s), expected exactly 1', v_n; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='transport_assign_vendor'
                    and pg_get_function_identity_arguments(p.oid) like '%p_driver_reg text') then
    raise exception '373: the surviving transport_assign_vendor does not take p_driver_reg'; end if;

  -- the confirmation sends the new notification, keyed to a rule that exists
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='transport_confirm_assignments';
  if v_def !~ 'Create Tafweej' or v_def !~ '/tafweej' then raise exception '373: confirm does not send Create Tafweej'; end if;
  if not exists (select 1 from notification_rules where rule_key='transport.tafweej_agent' and audience='agent' and enabled) then
    raise exception '373: transport.tafweej_agent rule missing'; end if;
  if (select rule_key from notification_rule_for('agent','transport','transport','Create Tafweej — TB-000001')) <> 'transport.tafweej_agent' then
    raise exception '373: the rule does not match its own title'; end if;

  -- grants: the internal ones shut, the staff ones staff-only, the agent one open
  if has_function_privilege('authenticated','public.trip_tafweej_details(uuid,boolean)','execute')
     or has_function_privilege('anon','public.trip_tafweej_details(uuid,boolean)','execute') then
    raise exception '373: trip_tafweej_details is callable from a browser'; end if;
  if has_function_privilege('anon','public.transport_trip_tafweej(uuid)','execute')
     or has_function_privilege('anon','public.arrival_transport_by_vista(integer)','execute')
     or has_function_privilege('anon','public.arrival_compliance(integer)','execute') then
    raise exception '373: a staff list is anon-callable'; end if;
  if not has_function_privilege('anon','public.b2b_trip_tafweej(text,uuid)','execute') then
    raise exception '373: the agent portal cannot call b2b_trip_tafweej'; end if;

  raise notice '373 ok';
end
$chk$;

commit;
