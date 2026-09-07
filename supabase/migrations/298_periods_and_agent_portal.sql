-- 298 Periods take package prices in, and the agent sees them too.
--
-- 295 built rate periods out of the route rates alone, because package prices
-- carried no dates. 297 gave them dates, so a package price change now moves the
-- chart and has to be able to start a period: the boundaries take
-- transport_package_prices in as well, and the signature that decides whether
-- two boundaries are really the same chart now covers both halves of it.
--
-- The agent gets the same thing. b2b_transport_rate_periods() and
-- b2b_transport_rate_chart() are the token-gated pair of the office's
-- transport_rate_periods() and transport_agent_rate_chart(), resolving through
-- the same transport_agent_rate() and transport_package_price(), so the office
-- and the agent cannot be looking at different periods or different prices.
--
-- b2b_transport_masters() is deliberately NOT changed: the booking form calls it
-- and must go on quoting today's price. The chart is a separate read.
--
-- The two b2b functions are anon by design — the portal has no Supabase session,
-- only a token — so they are granted to anon explicitly rather than through
-- PUBLIC, per migration 293.

-- (bodies below are exactly what was applied)

create or replace function public.transport_rate_periods(p_party uuid default null)
returns jsonb language sql stable security invoker set search_path to 'public' as $$
  with co as (select auth_company_id() as id),
  bounds as (
    select distinct d from (
      select effective_from as d from transport_agent_rates
       where company_id = (select id from co) and status = 'active'
         and (agent_id is not distinct from p_party or agent_id is null)
      union
      select effective_to + 1 from transport_agent_rates
       where company_id = (select id from co) and status = 'active'
         and (agent_id is not distinct from p_party or agent_id is null)
         and effective_to is not null
      union
      select effective_from from transport_package_prices
       where company_id = (select id from co) and coalesce(status,'active') = 'active'
         and (agent_id is not distinct from p_party or agent_id is null)
      union
      select effective_to + 1 from transport_package_prices
       where company_id = (select id from co) and coalesce(status,'active') = 'active'
         and (agent_id is not distinct from p_party or agent_id is null)
         and effective_to is not null
    ) x where d is not null
  ),
  route_sig as (
    select b.d,
           count(x.rate) as cells,
           coalesce(string_agg(r.id::text || ve.id::text || x.rate::text, ',' order by r.id, ve.id)
                    filter (where x.rate is not null), '') as s
    from bounds b
    cross join transport_routes r
    cross join transport_vehicles ve
    cross join lateral (select transport_agent_rate((select id from co), p_party, r.id, ve.id, b.d) as rate) x
    where r.company_id = (select id from co) and r.is_active
      and ve.company_id = (select id from co) and ve.is_active
    group by b.d
  ),
  pkg_sig as (
    select b.d,
           count(x.price) as cells,
           coalesce(string_agg(pk.id::text || ve.id::text || x.price::text, ',' order by pk.id, ve.id)
                    filter (where x.price is not null), '') as s
    from bounds b
    cross join transport_packages pk
    cross join transport_vehicles ve
    cross join lateral (select transport_package_price((select id from co), p_party, pk.id, ve.id, b.d) as price) x
    where pk.company_id = (select id from co) and pk.is_active
      and ve.company_id = (select id from co) and ve.is_active
    group by b.d
  ),
  sig as (
    select b.d,
           coalesce(r.cells, 0) + coalesce(p.cells, 0) as cells,
           md5(coalesce(r.s, '') || '|' || coalesce(p.s, '')) as s
    from bounds b
    left join route_sig r on r.d = b.d
    left join pkg_sig p on p.d = b.d
  ),
  marked as (
    select d, cells, s, lag(s) over (order by d) as prev_s from sig
  ),
  runs as (
    select d, cells, s,
           sum(case when s is distinct from prev_s then 1 else 0 end) over (order by d) as grp
    from marked
  ),
  periods as (
    select grp, min(d) as from_date, max(cells) as cells from runs group by grp
  ),
  windowed as (
    select from_date, cells, lead(from_date) over (order by from_date) as to_date
    from periods
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'from',    from_date,
           'to',      to_date,
           'cells',   cells,
           'past',    to_date is not null and to_date <= current_date,
           'current', from_date <= current_date and (to_date is null or to_date > current_date),
           'future',  from_date > current_date) order by from_date), '[]'::jsonb)
  from windowed
  where cells > 0;
$$;

revoke all on function public.transport_rate_periods(uuid) from public, anon;
grant execute on function public.transport_rate_periods(uuid) to authenticated;

-- The agent's own pair. Same shape, resolved from the portal token.
-- (Full bodies as applied; b2b_transport_rate_periods repeats the query above
--  with the token's party, written as nested subqueries because a plpgsql body
--  cannot start with a WITH and still assign INTO.)
create or replace function public.b2b_transport_rate_periods(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare a b2b_agents%rowtype; v_party uuid; v jsonb;
begin
  a := b2b_agent_of(p_token);
  v_party := coalesce(a.agent_party_id, a.id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'from', from_date, 'to', to_date, 'cells', cells,
           'past',    to_date is not null and to_date <= current_date,
           'current', from_date <= current_date and (to_date is null or to_date > current_date),
           'future',  from_date > current_date) order by from_date), '[]'::jsonb)
    into v
  from (
    select from_date, cells, lead(from_date) over (order by from_date) as to_date
    from (
      select grp, min(d) as from_date, max(cells) as cells
      from (
        select d, cells, s,
               sum(case when s is distinct from prev_s then 1 else 0 end) over (order by d) as grp
        from (
          select d, cells, s, lag(s) over (order by d) as prev_s
          from (
            select b.d,
                   coalesce(r.cells, 0) + coalesce(p.cells, 0) as cells,
                   md5(coalesce(r.s, '') || '|' || coalesce(p.s, '')) as s
            from (
              select distinct d from (
                select effective_from as d from transport_agent_rates
                 where company_id = a.company_id and status = 'active'
                   and (agent_id is not distinct from v_party or agent_id is null)
                union select effective_to + 1 from transport_agent_rates
                 where company_id = a.company_id and status = 'active'
                   and (agent_id is not distinct from v_party or agent_id is null) and effective_to is not null
                union select effective_from from transport_package_prices
                 where company_id = a.company_id and coalesce(status,'active') = 'active'
                   and (agent_id is not distinct from v_party or agent_id is null)
                union select effective_to + 1 from transport_package_prices
                 where company_id = a.company_id and coalesce(status,'active') = 'active'
                   and (agent_id is not distinct from v_party or agent_id is null) and effective_to is not null
              ) x where d is not null
            ) b
            left join lateral (
              select count(y.rate) as cells,
                     coalesce(string_agg(rt.id::text || ve.id::text || y.rate::text, ',' order by rt.id, ve.id)
                              filter (where y.rate is not null), '') as s
              from transport_routes rt cross join transport_vehicles ve
              cross join lateral (select transport_agent_rate(a.company_id, v_party, rt.id, ve.id, b.d) as rate) y
              where rt.company_id = a.company_id and rt.is_active and ve.company_id = a.company_id and ve.is_active
            ) r on true
            left join lateral (
              select count(y.price) as cells,
                     coalesce(string_agg(pk.id::text || ve.id::text || y.price::text, ',' order by pk.id, ve.id)
                              filter (where y.price is not null), '') as s
              from transport_packages pk cross join transport_vehicles ve
              cross join lateral (select transport_package_price(a.company_id, v_party, pk.id, ve.id, b.d) as price) y
              where pk.company_id = a.company_id and pk.is_active and ve.company_id = a.company_id and ve.is_active
            ) p on true
          ) s1
        ) s2
      ) s3 group by grp
    ) s4
  ) s5
  where cells > 0;
  return v;
end $fn$;

create or replace function public.b2b_transport_rate_chart(p_token text, p_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare a b2b_agents%rowtype; v_party uuid; v jsonb;
begin
  a := b2b_agent_of(p_token);
  v_party := coalesce(a.agent_party_id, a.id);
  select jsonb_build_object(
    'as_of', p_date,
    'routes', coalesce((select jsonb_agg(x) from (
       select id, name, is_airport from transport_routes
       where company_id = a.company_id and is_active order by name) x), '[]'::jsonb),
    'vehicles', coalesce((select jsonb_agg(x) from (
       select id, name, seating_capacity from transport_vehicles
       where company_id = a.company_id and is_active order by sort_order, name) x), '[]'::jsonb),
    'rates', coalesce((select jsonb_agg(jsonb_build_object(
         'route_id', r.id, 'vehicle_id', ve.id, 'sell_rate', x.rate))
       from transport_routes r cross join transport_vehicles ve
       cross join lateral (select transport_agent_rate(a.company_id, v_party, r.id, ve.id, p_date) as rate) x
       where r.company_id = a.company_id and r.is_active
         and ve.company_id = a.company_id and ve.is_active and x.rate is not null), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(x) from (
       select id, name, price, package_type from transport_packages
       where company_id = a.company_id and is_active order by name) x), '[]'::jsonb),
    'packagePrices', coalesce((select jsonb_agg(jsonb_build_object(
         'package_id', t.package_id, 'vehicle_id', t.vehicle_id, 'price', t.price))
       from (select distinct pp.package_id, pp.vehicle_id,
                    transport_package_price(a.company_id, v_party, pp.package_id, pp.vehicle_id, p_date) as price
             from transport_package_prices pp where pp.company_id = a.company_id) t
       where t.price is not null), '[]'::jsonb))
  into v;
  return v;
end $fn$;

revoke all on function public.b2b_transport_rate_periods(text) from public;
revoke all on function public.b2b_transport_rate_chart(text, date) from public;
grant execute on function public.b2b_transport_rate_periods(text) to anon, authenticated;
grant execute on function public.b2b_transport_rate_chart(text, date) to anon, authenticated;
