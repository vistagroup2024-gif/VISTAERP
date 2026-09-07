-- 297 Package prices become effective-dated, like the route rates already are.
--
-- transport_agent_rates has carried effective_from / effective_to / status since
-- the beginning: change a rate and you add a row with a new effective date, and
-- what a booking was quoted stays readable for ever. transport_package_prices
-- had none of that — one row per package x vehicle x agent, updated in place, so
-- setting next month's price destroyed this month's and there was no way to
-- enter one ahead of time.
--
-- Same three columns, same rules, same resolver shape.

alter table transport_package_prices
  add column if not exists effective_from date,
  add column if not exists effective_to   date,
  add column if not exists status         text not null default 'active';

-- Existing rows are whatever has always been true, so they start in the far past
-- rather than today: a booking dated before this migration must still resolve.
update transport_package_prices set effective_from = '2000-01-01' where effective_from is null;
alter table transport_package_prices alter column effective_from set not null;
alter table transport_package_prices alter column effective_from set default current_date;

comment on column transport_package_prices.effective_from is
  'The date this price starts. Changing a package price adds a row with a new effective_from; the old row stays as history, exactly like transport_agent_rates.';

-- One price per package x vehicle x agent PER EFFECTIVE DATE. The old index
-- allowed only one row per agent at all, which is what made history impossible.
drop index if exists tpp_pkg_veh_agent_uidx;
create unique index if not exists tpp_pkg_veh_agent_from_uidx
  on transport_package_prices (package_id, vehicle_id,
                               coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
                               effective_from);
create index if not exists idx_tpp_effective on transport_package_prices (package_id, effective_from);

-- ── The resolver ────────────────────────────────────────────────────────────
-- Line for line the shape of transport_agent_rate(): the agent's own price wins
-- over the standard one, and within that the latest one that has started.
drop function if exists public.transport_package_price(uuid, uuid, uuid, uuid);
create or replace function public.transport_package_price(
  p_company uuid, p_agent uuid, p_package uuid, p_vehicle uuid,
  p_date date default current_date)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select price from transport_package_prices
  where company_id = p_company and package_id = p_package and vehicle_id = p_vehicle
    and coalesce(status, 'active') = 'active'
    and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
    and (agent_id = p_agent or agent_id is null)
  order by (case when agent_id is not distinct from p_agent then 0 else 1 end), effective_from desc
  limit 1;
$$;
revoke all on function public.transport_package_price(uuid, uuid, uuid, uuid, date) from public, anon;
grant execute on function public.transport_package_price(uuid, uuid, uuid, uuid, date) to authenticated;

-- ── The setter ──────────────────────────────────────────────────────────────
-- Saving a price no longer overwrites: it writes the row for that effective
-- date, leaving every earlier one where it is. Clearing (a null price) removes
-- only the row for that date, so an old price is never destroyed by blanking a
-- new one.
drop function if exists public.set_package_price(uuid, uuid, uuid, numeric);
create or replace function public.set_package_price(
  p_package uuid, p_vehicle uuid, p_agent uuid, p_price numeric,
  p_from date default current_date)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := auth_company_id(); v_from date := coalesce(p_from, current_date);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if p_price is null then
    delete from transport_package_prices
    where company_id = v_company and package_id = p_package and vehicle_id = p_vehicle
      and agent_id is not distinct from p_agent and effective_from = v_from;
    return;
  end if;
  update transport_package_prices set price = p_price, status = 'active'
    where company_id = v_company and package_id = p_package and vehicle_id = p_vehicle
      and agent_id is not distinct from p_agent and effective_from = v_from;
  if not found then
    insert into transport_package_prices(company_id, package_id, vehicle_id, agent_id, price, effective_from)
    values (v_company, p_package, p_vehicle, p_agent, p_price, v_from);
  end if;
end $$;
revoke all on function public.set_package_price(uuid, uuid, uuid, numeric, date) from public, anon;
grant execute on function public.set_package_price(uuid, uuid, uuid, numeric, date) to authenticated;

-- ── The callers get the date they already have ──────────────────────────────
-- Spliced rather than restated: these are long routines and only the one call
-- changes. Each splice must match exactly once or the migration fails rather
-- than half-applying.
do $$
declare v_def text; v_new text; n int; patch record;
begin
  for patch in
    select * from (values
      -- The two booking savers already resolve ROUTE rates on the booking date;
      -- the package price now follows the same date instead of today's.
      ('transport_save_booking(uuid,jsonb,jsonb)',
       'transport_package_price(v_company, v_agent, v_pkg, v_pkg_veh)',
       'transport_package_price(v_company, v_agent, v_pkg, v_pkg_veh, v_bdate)'),
      ('b2b_transport_save_booking(text,uuid,jsonb,jsonb)',
       'transport_package_price(a.company_id, v_party, v_pkg, v_pkg_veh)',
       'transport_package_price(a.company_id, v_party, v_pkg, v_pkg_veh, v_bdate)'),
      -- Reopening restores what the booking was priced at, so it reads the price
      -- as of that booking's own date.
      ('transport_reopen_trip(uuid)',
       'transport_package_price(v_company, b.agent_id, b.orig_package_id, v_veh)',
       'transport_package_price(v_company, b.agent_id, b.orig_package_id, v_veh, b.booking_date)'),
      -- The agent's portal chart and the office chart pass the date they are
      -- drawing for, so package prices move with the period like route rates do.
      ('b2b_transport_masters(text)',
       'transport_package_price(a.company_id, v_party, pp.package_id, pp.vehicle_id)',
       'transport_package_price(a.company_id, v_party, pp.package_id, pp.vehicle_id, current_date)'),
      ('transport_agent_rate_chart(uuid,date)',
       'transport_package_price(v_co, p_party, pp.package_id, pp.vehicle_id)',
       'transport_package_price(v_co, p_party, pp.package_id, pp.vehicle_id, p_date)')
    ) as t(sig, find, repl)
  loop
    -- The WHOLE definition, not just the body: language, volatility, security and
    -- search_path come back with it, so a splice cannot quietly turn an invoker
    -- report into a definer one or a stable function into a volatile one.
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.oid::regprocedure::text = patch.sig;
    if v_def is null then raise exception 'not found: %', patch.sig; end if;

    n := (length(v_def) - length(replace(v_def, patch.find, ''))) / length(patch.find);
    if n <> 1 then raise exception 'splice into % matched % times, expected 1', patch.sig, n; end if;

    v_new := replace(v_def, patch.find, patch.repl);
    execute v_new;
  end loop;
end $$;
