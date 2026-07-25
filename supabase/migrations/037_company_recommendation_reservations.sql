-- 037_company_recommendation_reservations.sql
-- Company Recommendation tool (pre-visa company selection) + temporary
-- reservations + configurable expiry. Available to BOTH the Admin Portal
-- (authenticated) and the B2B Agent Portal (via token wrappers).
--
-- Reservations are a COORDINATION-ONLY concept. They never consume BRN
-- inventory, never create BRN history, never affect purchase planning or hotel
-- allocation. They only nudge the recommendation engine so two users don't both
-- pick the same company for the same dates. They expire automatically after a
-- configurable number of minutes, or the moment a Visa Group is created for the
-- reserved company + dates.

-- ---------------------------------------------------------------------------
-- Configurable ERP settings (key/value)
-- ---------------------------------------------------------------------------
create table if not exists erp_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into erp_settings (key, value) values ('company_reservation_minutes', '20')
  on conflict (key) do nothing;

create or replace function get_setting(p_key text, p_default text default null)
 returns text language sql stable security definer set search_path to 'public'
as $$ select coalesce((select value from erp_settings where key = p_key), p_default) $$;

create or replace function set_setting(p_key text, p_value text)
 returns void language plpgsql security definer set search_path to 'public'
as $$ begin
  insert into erp_settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Temporary company reservations
-- ---------------------------------------------------------------------------
create table if not exists company_reservations (
  id uuid primary key default gen_random_uuid(),
  group_company_id uuid not null references group_companies(id),
  arrival_date date not null,
  departure_date date not null,
  pax int not null check (pax > 0),
  source text not null default 'admin',   -- 'admin' | 'agent'
  created_by text,                          -- staff email or agency name
  agent_id uuid,                            -- b2b_agents.id when source = 'agent'
  expires_at timestamptz not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_company_reservations_active
  on company_reservations (group_company_id, expires_at) where not consumed;

-- All access is through SECURITY DEFINER RPCs; deny direct table access.
alter table company_reservations enable row level security;
alter table erp_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Recommendation engine (shared core)
-- ---------------------------------------------------------------------------
-- For the requested stay, score every active company by how well its own BRN
-- inventory (minus existing consumption and minus active reservations) can serve
-- `pax` beds each night. Respects the first/last-night tolerance: a company that
-- covers the whole main stay counts as "complete" even if the very first or last
-- night is short. Ranking: complete first, then most nights covered, then the
-- largest available inventory (so otherwise-idle inventory gets consumed).
create or replace function recommend_companies(p_arrival date, p_departure date, p_pax int)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if p_arrival is null or p_departure is null or p_departure <= p_arrival or coalesce(p_pax, 0) <= 0 then
    raise exception 'Provide an arrival date, a later departure date, and pax greater than zero.';
  end if;

  with nights as (
    select d::date as night,
           (d::date = p_arrival) as is_first,
           (d::date = p_departure - 1) as is_last
    from generate_series(p_arrival, p_departure - 1, interval '1 day') d
  ),
  comp as (select id, name from group_companies where is_active = true),
  avail as (
    select c.id as company_id, n.night, n.is_first, n.is_last,
      greatest(0,
        coalesce((select sum(b.beds) from brn_inventory b
                  where b.group_company_id = c.id and b.check_in <= n.night and b.check_out > n.night), 0)
        - coalesce((select sum(cs.beds) from brn_consumption cs
                    join brn_inventory b2 on b2.id = cs.brn_id
                    where b2.group_company_id = c.id and cs.check_in <= n.night and cs.check_out > n.night), 0)
        - coalesce((select sum(r.pax) from company_reservations r
                    where r.group_company_id = c.id and not r.consumed and r.expires_at > now()
                      and r.arrival_date <= n.night and r.departure_date > n.night), 0)
      ) as beds
    from comp c cross join nights n
  ),
  scored as (
    select a.company_id,
      count(*) as total_nights,
      count(*) filter (where a.beds >= p_pax) as covered_nights,
      count(*) filter (where not a.is_first and not a.is_last) as main_nights,
      count(*) filter (where not a.is_first and not a.is_last and a.beds >= p_pax) as main_covered,
      sum(a.beds) as bed_nights_avail,
      min(a.beds) as min_beds
    from avail a group by a.company_id
  ),
  ranked as (
    select s.*, c.name,
      case when s.main_nights = 0 then (s.covered_nights = s.total_nights)
           else (s.main_covered = s.main_nights) end as complete,
      coalesce((select sum(r.pax) from company_reservations r
                where r.group_company_id = s.company_id and not r.consumed and r.expires_at > now()
                  and r.arrival_date < p_departure and r.departure_date > p_arrival), 0) as reserved_beds
    from scored s join comp c on c.id = s.company_id
  )
  select jsonb_agg(jsonb_build_object(
    'id', company_id, 'name', name, 'complete', complete,
    'covered_nights', covered_nights, 'total_nights', total_nights,
    'pct', case when total_nights > 0 then round(100.0 * covered_nights / total_nights) else 0 end,
    'available_bed_nights', bed_nights_avail, 'min_beds', min_beds, 'reserved_beds', reserved_beds
  ) order by complete desc, covered_nights desc, bed_nights_avail desc)
  into v from ranked;

  return coalesce(v, '[]'::jsonb);
end $$;

create or replace function create_company_reservation(
  p_company uuid, p_arrival date, p_departure date, p_pax int,
  p_source text default 'admin', p_created_by text default null, p_agent_id uuid default null)
 returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid; v_min int;
begin
  if p_company is null or p_arrival is null or p_departure is null or p_departure <= p_arrival or coalesce(p_pax,0) <= 0 then
    raise exception 'Invalid reservation.';
  end if;
  v_min := coalesce(nullif(get_setting('company_reservation_minutes', '20'), '')::int, 20);
  insert into company_reservations (group_company_id, arrival_date, departure_date, pax, source, created_by, agent_id, expires_at)
  values (p_company, p_arrival, p_departure, p_pax, coalesce(p_source,'admin'), p_created_by, p_agent_id, now() + make_interval(mins => v_min))
  returning id into v_id;
  return v_id;
end $$;

create or replace function active_reservations()
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'company', gc.name, 'group_company_id', r.group_company_id,
    'arrival_date', r.arrival_date, 'departure_date', r.departure_date, 'pax', r.pax,
    'source', r.source, 'created_by', r.created_by, 'expires_at', r.expires_at
  ) order by r.expires_at), '[]'::jsonb)
  from company_reservations r join group_companies gc on gc.id = r.group_company_id
  where not r.consumed and r.expires_at > now();
$$;

create or replace function release_company_reservation(p_id uuid)
 returns void language sql security definer set search_path to 'public'
as $$ update company_reservations set consumed = true where id = p_id; $$;

-- ---------------------------------------------------------------------------
-- B2B token wrappers (agent portal calls these)
-- ---------------------------------------------------------------------------
create or replace function b2b_recommend_companies(p_token text, p_arrival date, p_departure date, p_pax int)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$ begin
  perform b2b_agent_of(p_token);
  return recommend_companies(p_arrival, p_departure, p_pax);
end $$;

create or replace function b2b_create_company_reservation(p_token text, p_company uuid, p_arrival date, p_departure date, p_pax int)
 returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  return create_company_reservation(p_company, p_arrival, p_departure, p_pax, 'agent', a.agency_name, a.id);
end $$;

create or replace function b2b_active_reservations(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$ begin
  perform b2b_agent_of(p_token);
  return active_reservations();
end $$;

-- ---------------------------------------------------------------------------
-- Auto-consume matching reservations when a Visa Group is created
-- ---------------------------------------------------------------------------
create or replace function consume_company_reservations()
 returns trigger language plpgsql security definer set search_path to 'public'
as $$ begin
  if new.group_company_id is not null then
    update company_reservations set consumed = true
    where group_company_id = new.group_company_id and not consumed and expires_at > now()
      and arrival_date = new.arrival_date and departure_date = new.departure_date;
  end if;
  return new;
end $$;

drop trigger if exists trg_consume_reservations on umrah_groups;
create trigger trg_consume_reservations after insert on umrah_groups
  for each row execute function consume_company_reservations();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function get_setting(text, text) to anon, authenticated;
grant execute on function set_setting(text, text) to authenticated;
grant execute on function recommend_companies(date, date, int) to anon, authenticated;
grant execute on function create_company_reservation(uuid, date, date, int, text, text, uuid) to authenticated;
grant execute on function active_reservations() to anon, authenticated;
grant execute on function release_company_reservation(uuid) to authenticated;
grant execute on function b2b_recommend_companies(text, date, date, int) to anon, authenticated;
grant execute on function b2b_create_company_reservation(text, uuid, date, date, int) to anon, authenticated;
grant execute on function b2b_active_reservations(text) to anon, authenticated;
