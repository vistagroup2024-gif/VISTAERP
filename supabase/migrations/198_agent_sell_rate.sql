-- The agent's own selling fare per trip (their price to their client), used to print an
-- agent invoice-style voucher. Private to the agent; never affects Vista pricing.
alter table transport_trips add column if not exists agent_sell_rate numeric;

create or replace function public.b2b_transport_set_agent_fares(p_token text, p_id uuid, p_fares jsonb)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare a b2b_agents%rowtype; e jsonb;
begin
  a := b2b_agent_of(p_token);
  if a.id is null then raise exception 'Invalid session'; end if;
  if not exists (select 1 from transport_bookings b where b.id = p_id
                   and b.company_id = a.company_id and b.agent_id = coalesce(a.agent_party_id, a.id)) then
    raise exception 'Booking not found';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_fares, '[]'::jsonb)) loop
    update transport_trips set agent_sell_rate = nullif(e->>'fare','')::numeric
    where id = (e->>'id')::uuid and booking_id = p_id;
  end loop;
end $function$;
revoke all on function public.b2b_transport_set_agent_fares(text, uuid, jsonb) from anon;
