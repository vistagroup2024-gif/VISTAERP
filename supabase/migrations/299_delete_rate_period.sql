-- 299 Deleting a rate period.
--
-- A period is not a row — it is the stretch a set of effective-dated rows holds
-- the chart for. So deleting one means deleting the rows that START it: the
-- route rates and the package prices whose effective_from is that period's first
-- day. What was in force before then simply carries on, which is the whole point
-- of undoing a rate change.
--
-- Only the rows belonging to the chart you are looking at go. Delete a period
-- while viewing an agent and only that agent's rows are removed; the standard
-- rates every other agent falls back on are untouched. Delete it on the Standard
-- chart and only the agent_id-is-null rows go. A boundary an agent inherits from
-- a standard-rate change is therefore not theirs to delete, and the routine says
-- so rather than quietly deleting nothing.
--
-- ADMIN ONLY. Everything else in the transport module is open to staff with the
-- module permission; this one destroys pricing history, so it is has_role('admin')
-- and it is written to the audit log with the counts.
--
-- It does NOT rewrite what has already been sold: transport_trips carries its own
-- sell_rate and normal_rate, set when the booking was saved, and no foreign key
-- points at either rate table. Deleting a period changes what future lookups
-- resolve, not what a past booking was charged.
create or replace function public.transport_rate_period_delete(p_party uuid, p_from date)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_co uuid := auth_company_id(); n_rates int; n_prices int; v_who text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if not has_role('admin') then
    raise exception 'Deleting a rate period is an admin-only action.';
  end if;
  if p_from is null then raise exception 'Which period?'; end if;

  select count(*) into n_rates from transport_agent_rates
   where company_id = v_co and agent_id is not distinct from p_party and effective_from = p_from;
  select count(*) into n_prices from transport_package_prices
   where company_id = v_co and agent_id is not distinct from p_party and effective_from = p_from;

  if n_rates = 0 and n_prices = 0 then
    raise exception 'Nothing to delete: this period does not start with % rates of their own. It begins where the standard rates change, so delete it on the Standard chart instead.',
      case when p_party is null then 'standard' else 'this agent''s' end;
  end if;

  delete from transport_agent_rates
   where company_id = v_co and agent_id is not distinct from p_party and effective_from = p_from;
  delete from transport_package_prices
   where company_id = v_co and agent_id is not distinct from p_party and effective_from = p_from;

  select name into v_who from parties where id = p_party;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'transport_rate_period_deleted', 'transport_rate_period', p_party,
          jsonb_build_object('agent', coalesce(v_who, 'Standard'), 'effective_from', p_from,
                             'route_rates_deleted', n_rates, 'package_prices_deleted', n_prices));

  return jsonb_build_object('rates', n_rates, 'prices', n_prices,
                            'agent', coalesce(v_who, 'Standard'), 'from', p_from);
end $fn$;

revoke all on function public.transport_rate_period_delete(uuid, date) from public, anon;
grant execute on function public.transport_rate_period_delete(uuid, date) to authenticated;
