-- ============================================================
-- VISTA ERP - 014 Umrah Group Management & BRN Allocation
-- Entry point of the visa workflow. Groups auto-allocate hotel
-- BRN inventory (greedy, overbooking-safe) for Nusuk Masar.
-- ============================================================

-- Airports / cities reference (searchable dropdowns)
create table if not exists airports (
  code       text primary key,
  name       text not null,
  city       text,
  country    text,
  is_saudi   boolean not null default false
);
alter table airports enable row level security;
create policy airports_read on airports for select to authenticated using (true);
-- (seed data inserted separately — Saudi + major international airports)

create table if not exists umrah_groups (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  group_no         text not null,
  group_date       date not null default current_date,
  group_name       text,
  pax              integer not null check (pax > 0),
  agent_id         uuid references parties(id) on delete set null,
  ref_company_id   uuid references companies(id) on delete set null,
  arrival_date     date not null,
  arrival_flight   text,
  arrival_from     text references airports(code),
  arrival_airport  text references airports(code),
  departure_date   date not null,
  departure_flight text,
  departure_to     text references airports(code),
  departure_airport text references airports(code),
  total_nights     integer generated always as (departure_date - arrival_date) stored,
  brn_status       text not null default 'pending',
  visa_status      text not null default 'pending',
  remarks          text,
  created_at       timestamptz not null default now(),
  unique (company_id, group_no),
  check (departure_date > arrival_date)
);
create index if not exists idx_umrah_groups_company on umrah_groups(company_id);

create table if not exists group_brn_allocation (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  group_id        uuid not null references umrah_groups(id) on delete cascade,
  brn_id          uuid not null references brn_inventory(id) on delete cascade,
  consumption_id  uuid references brn_consumption(id) on delete set null,
  beds            integer not null check (beds > 0),
  created_at      timestamptz not null default now()
);
create index if not exists idx_group_brn_alloc_group on group_brn_allocation(group_id);

alter table umrah_groups         enable row level security;
alter table group_brn_allocation enable row level security;

create policy umrah_groups_staff on umrah_groups for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());
create policy group_brn_alloc_staff on group_brn_allocation for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

-- Auto group number: VG-YYYY-00001
create or replace function next_group_no(p_company uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_num bigint;
begin
  insert into doc_sequences(company_id, doc_type, prefix)
  values (p_company, 'umrah_group', 'VG-')
  on conflict (company_id, doc_type) do nothing;
  update doc_sequences set next_number = next_number + 1
    where company_id = p_company and doc_type = 'umrah_group'
    returning next_number - 1 into v_num;
  return 'VG-' || to_char(current_date, 'YYYY') || '-' || lpad(v_num::text, 5, '0');
end;
$$;

-- BRNs that can cover the group's full stay + how many beds each can give
create or replace function group_brn_recommendation(p_group uuid)
returns table(brn_id uuid, brn text, hotel_name text, city text, allocatable integer)
language sql stable security definer set search_path = public as $$
  with g as (select * from umrah_groups where id = p_group)
  select inv.id, inv.brn, inv.hotel_name, inv.city,
    (select min(inv.beds - coalesce((
        select sum(c.beds)::int from brn_consumption c
        where c.brn_id = inv.id and c.check_in <= d::date and c.check_out > d::date
      ), 0))
     from generate_series((select arrival_date from g),
                          (select departure_date from g) - interval '1 day',
                          interval '1 day') d
    )::int as allocatable
  from brn_inventory inv, g
  where inv.company_id = g.company_id
    and inv.check_in <= g.arrival_date
    and inv.check_out >= g.departure_date
  order by allocatable desc nulls last;
$$;

-- Greedy auto-allocation, atomic + overbooking-safe (via consume_brn)
create or replace function allocate_group_brns(p_group uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  g umrah_groups%rowtype; needed integer; take integer; rec record;
  v_cons uuid; allocated integer := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into g from umrah_groups where id = p_group for update;
  if not found then raise exception 'Group not found'; end if;
  if g.brn_status = 'allocated' then
    raise exception 'Group % already has BRNs allocated', g.group_no;
  end if;
  needed := g.pax;
  for rec in select * from group_brn_recommendation(p_group) where allocatable > 0 loop
    exit when needed <= 0;
    take := least(needed, rec.allocatable);
    v_cons := consume_brn(rec.brn_id, g.arrival_date, g.departure_date, take, g.group_no, 'Auto-allocated');
    insert into group_brn_allocation(company_id, group_id, brn_id, consumption_id, beds)
    values (g.company_id, p_group, rec.brn_id, v_cons, take);
    needed := needed - take;
    allocated := allocated + take;
  end loop;
  if needed > 0 then
    raise exception 'Insufficient BRN inventory: allocated % of % beds for the full stay.', allocated, g.pax;
  end if;
  update umrah_groups set brn_status = 'allocated' where id = p_group;
  return allocated;
end;
$$;

create or replace function deallocate_group_brns(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  delete from brn_consumption where id in (
    select consumption_id from group_brn_allocation where group_id = p_group and consumption_id is not null
  );
  delete from group_brn_allocation where group_id = p_group;
  update umrah_groups set brn_status = 'pending' where id = p_group;
end;
$$;

revoke all on function next_group_no(uuid) from anon;
revoke all on function group_brn_recommendation(uuid) from anon;
revoke all on function allocate_group_brns(uuid) from anon, public;
revoke all on function deallocate_group_brns(uuid) from anon, public;
grant execute on function next_group_no(uuid) to authenticated;
grant execute on function group_brn_recommendation(uuid) to authenticated;
grant execute on function allocate_group_brns(uuid) to authenticated;
grant execute on function deallocate_group_brns(uuid) to authenticated;
