-- Agent cancellation requests: the agent flags a booking; an admin approves (cancels).
alter table transport_bookings add column if not exists cancel_requested boolean not null default false;
alter table transport_bookings add column if not exists cancel_reason text;
alter table transport_bookings add column if not exists cancel_requested_at timestamptz;

create or replace function public.b2b_transport_request_cancel(p_token text, p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare a b2b_agents%rowtype;
begin
  a := b2b_agent_of(p_token);
  if a.id is null then raise exception 'Invalid session'; end if;
  update transport_bookings set cancel_requested = true, cancel_reason = nullif(btrim(coalesce(p_reason,'')),''), cancel_requested_at = now()
  where id = p_id and company_id = a.company_id and agent_id = coalesce(a.agent_party_id, a.id)
    and status not in ('cancelled','completed');
  if not found then raise exception 'Booking not found or cannot be cancelled.'; end if;
end $function$;
revoke all on function public.b2b_transport_request_cancel(text, uuid, text) from anon;

create or replace function public.b2b_transport_my_bookings(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare a b2b_agents%rowtype; v jsonb;
begin
  a := b2b_agent_of(p_token);
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v from (
    select jsonb_build_object('id', id, 'booking_no', booking_no, 'booking_type', booking_type, 'status', status,
      'passenger_name', passenger_name, 'mobile', mobile, 'pax', pax, 'booking_date', booking_date,
      'total_amount', total_amount, 'currency', currency, 'cancel_requested', cancel_requested, 'created_at', created_at) as x
    from transport_bookings where company_id = a.company_id and agent_id = coalesce(a.agent_party_id, a.id)
  ) q;
  return v;
end $function$;
