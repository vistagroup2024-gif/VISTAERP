-- ============================================================
-- VISTA ERP - 013 Hotel BRN Inventory Management
-- Bulk hotel bed inventory (BRN) with automatic per-day
-- deduction and overbooking prevention.
-- ============================================================

create table brn_inventory (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  hotel_name  text not null,
  brn         text not null,
  city        text,
  check_in    date not null,
  check_out   date not null,
  beds        integer not null check (beds > 0),
  remarks     text,
  created_at  timestamptz not null default now(),
  check (check_out > check_in)
);
create index idx_brn_inventory_company on brn_inventory(company_id);
create index idx_brn_inventory_hotel on brn_inventory(hotel_name);

create table brn_consumption (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  brn_id        uuid not null references brn_inventory(id) on delete cascade,
  reference     text,
  check_in      date not null,
  check_out     date not null,
  beds          integer not null check (beds > 0),
  remarks       text,
  created_at    timestamptz not null default now(),
  check (check_out > check_in)
);
create index idx_brn_consumption_brn on brn_consumption(brn_id);
create index idx_brn_consumption_company on brn_consumption(company_id);

-- Daily availability for one BRN (one row per occupied night)
create or replace function brn_daily(p_brn uuid)
returns table(day date, capacity integer, used integer, available integer)
language sql stable security definer set search_path = public as $$
  select
    d::date as day,
    inv.beds as capacity,
    coalesce((
      select sum(c.beds)::int from brn_consumption c
      where c.brn_id = p_brn and c.check_in <= d::date and c.check_out > d::date
    ), 0) as used,
    inv.beds - coalesce((
      select sum(c.beds)::int from brn_consumption c
      where c.brn_id = p_brn and c.check_in <= d::date and c.check_out > d::date
    ), 0) as available
  from brn_inventory inv,
       generate_series(inv.check_in, inv.check_out - interval '1 day', interval '1 day') d
  where inv.id = p_brn
  order by d;
$$;

-- Consume inventory (atomic, overbooking-safe)
create or replace function consume_brn(
  p_brn       uuid,
  p_check_in  date,
  p_check_out date,
  p_beds      integer,
  p_reference text,
  p_remarks   text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_min  integer;
  v_inv  brn_inventory%rowtype;
begin
  if not is_staff() then
    raise exception 'Not authorized';
  end if;
  if p_beds is null or p_beds <= 0 then
    raise exception 'Beds required must be greater than zero';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'Check-out must be after check-in';
  end if;

  select * into v_inv from brn_inventory where id = p_brn for update;
  if not found then
    raise exception 'BRN not found';
  end if;

  if p_check_in < v_inv.check_in or p_check_out > v_inv.check_out then
    raise exception 'Requested stay (% to %) is outside the BRN range (% to %)',
      p_check_in, p_check_out, v_inv.check_in, v_inv.check_out;
  end if;

  select min(v_inv.beds - coalesce(u.used, 0)) into v_min
  from generate_series(p_check_in, p_check_out - interval '1 day', interval '1 day') d
  left join lateral (
    select sum(c.beds)::int as used from brn_consumption c
    where c.brn_id = p_brn and c.check_in <= d::date and c.check_out > d::date
  ) u on true;

  if v_min < p_beds then
    raise exception 'Insufficient inventory: only % bed(s) available on the tightest night of the requested stay', v_min;
  end if;

  insert into brn_consumption(company_id, brn_id, reference, check_in, check_out, beds, remarks)
  values (v_inv.company_id, p_brn, p_reference, p_check_in, p_check_out, p_beds, p_remarks)
  returning id into v_id;

  return v_id;
end;
$$;

alter table brn_inventory   enable row level security;
alter table brn_consumption enable row level security;

create policy brn_inventory_staff on brn_inventory for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

create policy brn_consumption_staff on brn_consumption for all to authenticated
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

revoke all on function brn_daily(uuid) from anon;
revoke all on function consume_brn(uuid,date,date,integer,text,text) from anon, public;
grant execute on function brn_daily(uuid) to authenticated;
grant execute on function consume_brn(uuid,date,date,integer,text,text) to authenticated;
