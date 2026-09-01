-- 271_transport_outsourced_posting.sql
-- Two faults on the Transport Invoices screen.
--
-- 1. The vendor side of an outsourced trip never posted.
--    transport_trip_post_gl gates the vendor-cost lines, and the cost centre,
--    on transport_trips.is_outsourced — but NOTHING ever sets that column true.
--    transport_assign_vendor records the outsourcing by setting the trip's
--    status to 'outsourced' and filling vendor_id / vendor_cost; it never
--    touches the flag. Every one of the 536 trips has is_outsourced = false.
--
--    So a completed trip with a vendor posted only its sell side
--        Dr Agent / Cr Transport Sales
--    and silently dropped
--        Dr Transport Cost / Cr Vendor
--    leaving the cost and the vendor payable out of the ledger, and tagging the
--    entry 'VISTA TRANSPORT' when it was really outsourced. 227 completed trips
--    carry a vendor and 222 carry a vendor cost.
--
--    A trip is outsourced when it has a vendor. The flag is still honoured if it
--    is ever set, but vendor_id is what actually decides now.
--
-- 2. A posted invoice could not be opened. The list returned no reference to the
--    journal entry, so the screen had nothing to link to. It now returns
--    entry_id and entry_no.

create or replace function transport_trip_post_gl(p_trip uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t transport_trips; b transport_bookings; v_co uuid; v_agent uuid; v_sales uuid; v_cost uuid; v_vendor uuid;
        v_sell numeric(18,2); v_vc numeric(18,2); v_cash numeric(18,2); lines jsonb := '[]'::jsonb; g jsonb;
        v_dr numeric(18,2); v_cr numeric(18,2); v_diff numeric(18,2); v_ro uuid; v_cc text; v_outsourced boolean;
begin
  select * into t from transport_trips where id = p_trip;
  if not found then return jsonb_build_object('posted', false, 'reason', 'trip not found'); end if;
  v_co := t.company_id;
  if t.gl_entry is not null then return jsonb_build_object('posted', false, 'reason', 'already posted'); end if;
  if coalesce(t.status,'') <> 'completed' then return jsonb_build_object('posted', false, 'reason', 'trip not completed'); end if;
  if coalesce(t.cancelled_with_booking,false) then return jsonb_build_object('posted', false, 'reason', 'cancelled'); end if;

  select * into b from transport_bookings where id = t.booking_id;
  if not found or b.agent_id is null then return jsonb_build_object('posted', false, 'reason', 'no booking/agent'); end if;

  -- Outsourced = the trip was given to a vendor. is_outsourced is honoured when
  -- set, but it never is, so vendor_id is what decides.
  v_outsourced := coalesce(t.is_outsourced, false) or t.vendor_id is not null;

  v_cc := case when v_outsourced then 'OUTSOURCE TRANSPORT' else 'VISTA TRANSPORT' end;
  v_agent := ensure_party_account(v_co, b.agent_id, 'customer');
  v_sales := acct_ensure_named(v_co, 'Transport Sales', 'income', '4', 'Revenue');
  v_sell  := round(coalesce(t.sell_rate, 0), 2);

  if v_agent is not null and v_sales is not null and v_sell > 0 then
    lines := lines || jsonb_build_array(
      jsonb_build_object('account_id', v_agent::text, 'debit', v_sell, 'credit', 0, 'description', 'Transport '||coalesce(b.booking_no,'')||'/'||coalesce(t.seq,0), 'cost_center', v_cc),
      jsonb_build_object('account_id', v_sales::text, 'debit', 0, 'credit', v_sell, 'description', coalesce(t.route_label,'Transport'), 'cost_center', v_cc));
  end if;

  if v_outsourced and t.vendor_id is not null then
    v_vendor := ensure_transport_vendor_account(v_co, t.vendor_id);
    v_vc := round(coalesce(t.vendor_cost, 0), 2);
    if v_vendor is not null and v_vc > 0 then
      v_cost := acct_ensure_named(v_co, 'Transport Cost', 'expense', '5', 'COGS');
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_cost::text, 'debit', v_vc, 'credit', 0, 'description', 'Vendor cost '||coalesce(b.booking_no,''), 'cost_center', v_cc),
        jsonb_build_object('account_id', v_vendor::text, 'debit', 0, 'credit', v_vc, 'description', 'Vendor '||coalesce(t.route_label,'')));
    end if;
    v_cash := round(coalesce(t.cash_received, 0), 2);
    if v_vendor is not null and v_agent is not null and v_cash > 0 then
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_vendor::text, 'debit', v_cash, 'credit', 0, 'description', 'Cash collected by vendor'),
        jsonb_build_object('account_id', v_agent::text, 'debit', 0, 'credit', v_cash, 'description', 'Cash collected by vendor', 'cost_center', v_cc));
    end if;
  end if;

  if jsonb_array_length(lines) = 0 then return jsonb_build_object('posted', false, 'reason', 'nothing to post'); end if;

  select coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0)
    into v_dr, v_cr from jsonb_array_elements(lines) x;
  v_diff := round(v_dr - v_cr, 2);
  if v_diff <> 0 then
    v_ro := acct_ensure_named(v_co, 'Round Off', 'expense', '5', 'Indirect Expense');
    if v_diff > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_ro::text, 'debit', 0, 'credit', v_diff, 'description', 'Round off'));
    else lines := lines || jsonb_build_array(jsonb_build_object('account_id', v_ro::text, 'debit', -v_diff, 'credit', 0, 'description', 'Round off')); end if;
  end if;

  g := gl_post(v_co, coalesce(t.trip_date, current_date), 'Transport '||coalesce(b.booking_no,'')||'/'||coalesce(t.seq,0), 'gl_transport', coalesce(b.booking_no,'')||'/'||coalesce(t.seq,0), lines);
  update transport_trips set gl_entry = (g->>'entry_id')::uuid, gl_posted_at = now() where id = p_trip;
  return jsonb_build_object('posted', true, 'sell', v_sell, 'vendor_cost', coalesce(v_vc,0), 'entry_no', g->>'entry_no');
end $$;

-- The list now reports outsourcing the same way, and carries the posted entry so
-- the screen can open it.
create or replace function transport_invoice_list(p_from date, p_to date, p_only_unposted boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'trip_id', t.id, 'doc', coalesce(b.booking_no,'')||'/'||coalesce(t.seq,0), 'date', t.trip_date,
    'agent', p.name, 'route', t.route_label, 'sell', coalesce(t.sell_rate,0),
    'outsourced', (coalesce(t.is_outsourced,false) or t.vendor_id is not null),
    'vendor', v.name, 'vendor_cost', coalesce(t.vendor_cost,0),
    'posted', (t.gl_entry is not null),
    'entry_id', t.gl_entry, 'entry_no', je.entry_no) order by t.trip_date desc, b.booking_no), '[]'::jsonb)
  from transport_trips t
  join transport_bookings b on b.id = t.booking_id
  left join parties p on p.id = b.agent_id
  left join transport_vendors v on v.id = t.vendor_id
  left join journal_entries je on je.id = t.gl_entry
  where t.company_id = auth_company_id() and t.status = 'completed' and coalesce(t.cancelled_with_booking,false) = false
    and (p_from is null or t.trip_date >= p_from) and (p_to is null or t.trip_date <= p_to)
    and (not p_only_unposted or t.gl_entry is null);
$$;

-- Stop the column lying: a trip with a vendor IS outsourced.
update transport_trips set is_outsourced = true
where vendor_id is not null and coalesce(is_outsourced,false) = false;
