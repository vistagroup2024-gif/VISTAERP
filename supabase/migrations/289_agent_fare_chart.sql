-- 289 The agent fare chart, seen from the office.
--
-- An agent logs in and sees their own transport rates: route x vehicle, then
-- package x vehicle. Nobody in the office could see that chart, so answering
-- "what are we actually offering this agent?" meant reading effective-dated rate
-- rows on the Rate Master and resolving them by hand.
--
-- These two functions serve the SAME chart to staff. The numbers come from
-- transport_agent_rate() and transport_package_price() — the identical two
-- functions b2b_transport_masters() calls for the agent — so the office and the
-- agent cannot be shown different prices.
--
-- Both are `security invoker` because they are reports (see CLAUDE.md): row-level
-- security reaches them, so a restricted user's chart is built only from what
-- they may see, and neither can be used to read another company's rates.

-- ── who there is a chart for ────────────────────────────────────────────────
-- Rates are keyed by PARTY, not by portal login (transport_agent_rates.agent_id
-- references parties). A party appears here if it has a portal login — the "id"
-- an agent signs in with — or if it has agent-specific rates of its own, so a
-- party that is priced but has no login is not invisible.
create or replace function public.transport_rate_chart_parties()
returns jsonb language sql stable security invoker set search_path to 'public' as $$
  with co as (select auth_company_id() as id),
  logins as (
    select coalesce(a.agent_party_id, a.id) as party_id, min(a.agency_name) as agency_name
    from b2b_agents a
    where a.company_id = (select id from co) and coalesce(a.status, 'active') = 'active'
    group by coalesce(a.agent_party_id, a.id)
  ),
  rated as (
    select distinct r.agent_id as party_id
    from transport_agent_rates r
    where r.company_id = (select id from co) and r.agent_id is not null and r.status = 'active'
  )
  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'party_id',      p.id,
      'name',          coalesce(l.agency_name, p.name),
      'party_name',    p.name,
      -- What the two badges on the picker mean: this party can sign in and see
      -- the chart itself / this party is priced differently from the standard.
      'has_login',     l.party_id is not null,
      'has_own_rates', rd.party_id is not null) as x
    from parties p
    left join logins l  on l.party_id  = p.id
    left join rated  rd on rd.party_id = p.id
    where p.company_id = (select id from co)
      and (l.party_id is not null or rd.party_id is not null)
  ) q;
$$;

revoke all on function public.transport_rate_chart_parties() from anon;
grant execute on function public.transport_rate_chart_parties() to authenticated;

-- ── the chart itself ────────────────────────────────────────────────────────
-- p_party null is the STANDARD chart — the rate an agent with nothing of their
-- own is quoted. That is not a special case in the pricing: transport_agent_rate
-- already falls back to the agent_id-is-null row, so passing null asks for
-- exactly the fallback.
--
-- p_date exists because selling rates are effective-dated. It defaults to today,
-- which is the date the agent's own screen uses, so the default view is the one
-- the agent is looking at; any other date answers "what did we quote them then"
-- or "what will they see when the new rates start".
create or replace function public.transport_agent_rate_chart(
  p_party uuid default null,
  p_date  date default current_date)
returns jsonb language plpgsql stable security invoker set search_path to 'public' as $fn$
declare v_co uuid := auth_company_id(); v jsonb;
begin
  select jsonb_build_object(
    'as_of',    p_date,
    'party_id', p_party,

    'routes', coalesce((select jsonb_agg(x) from (
       select id, name, is_airport from transport_routes
       where company_id = v_co and is_active order by name) x), '[]'::jsonb),

    'vehicles', coalesce((select jsonb_agg(x) from (
       select id, name, seating_capacity from transport_vehicles
       where company_id = v_co and is_active order by sort_order, name) x), '[]'::jsonb),

    -- One call per route x vehicle, through a lateral so the rate is resolved
    -- once and not again in the filter.
    'rates', coalesce((select jsonb_agg(jsonb_build_object(
         'route_id', r.id, 'vehicle_id', ve.id, 'sell_rate', x.rate))
       from transport_routes r
       cross join transport_vehicles ve
       cross join lateral (select transport_agent_rate(v_co, p_party, r.id, ve.id, p_date) as rate) x
       where r.company_id = v_co and r.is_active
         and ve.company_id = v_co and ve.is_active
         and x.rate is not null), '[]'::jsonb),

    'packages', coalesce((select jsonb_agg(x) from (
       select id, name, price, package_type from transport_packages
       where company_id = v_co and is_active order by name) x), '[]'::jsonb),

    'packagePrices', coalesce((select jsonb_agg(jsonb_build_object(
         'package_id', t.package_id, 'vehicle_id', t.vehicle_id, 'price', t.price))
       from (select distinct pp.package_id, pp.vehicle_id,
                    transport_package_price(v_co, p_party, pp.package_id, pp.vehicle_id) as price
             from transport_package_prices pp where pp.company_id = v_co) t
       where t.price is not null), '[]'::jsonb),

    -- How much of the chart is this agent's own rather than the standard rate.
    -- It says nothing the chart does not already show; it saves comparing two
    -- charts cell by cell to find out whether this agent is priced differently.
    'own_rate_cells', (select count(*) from (
       select distinct route_id, vehicle_id from transport_agent_rates
       where company_id = v_co and agent_id = p_party and status = 'active'
         and effective_from <= p_date and (effective_to is null or effective_to >= p_date)) q),
    'own_price_cells', (select count(*) from transport_package_prices
       where company_id = v_co and agent_id = p_party)
  ) into v;
  return v;
end $fn$;

revoke all on function public.transport_agent_rate_chart(uuid, date) from anon;
grant execute on function public.transport_agent_rate_chart(uuid, date) to authenticated;
