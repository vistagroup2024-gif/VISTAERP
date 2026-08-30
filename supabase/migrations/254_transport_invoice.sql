-- 254_transport_invoice.sql
-- Auto-post the transport invoice to the GL when a trip completes (per trip).
--   Customer:   Dr Agent (receivable) / Cr Transport Sales  = trip.sell_rate
--   Outsourced: Dr Transport Cost / Cr Vendor               = trip.vendor_cost
--   Vendor cash: if the vendor collected cash on our behalf,
--               Dr Vendor / Cr Agent                        = trip.cash_received
-- Cash in-house bookings just carry the receivable and are settled by a Receipt.
-- Cost center 'TRANSPORT'. Idempotent (trip.gl_entry marker). Feeds Sales Costing.

alter table transport_trips add column if not exists gl_entry uuid;
alter table transport_trips add column if not exists gl_posted_at timestamptz;

create or replace function transport_trip_post_gl(p_trip uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t transport_trips; b transport_bookings; v_co uuid; v_agent uuid; v_sales uuid; v_cost uuid; v_vendor uuid;
        v_sell numeric(18,2); v_vc numeric(18,2); v_cash numeric(18,2); lines jsonb := '[]'::jsonb; g jsonb;
        v_dr numeric(18,2); v_cr numeric(18,2); v_diff numeric(18,2); v_ro uuid; v_cc text := 'TRANSPORT';
begin
  select * into t from transport_trips where id = p_trip;
  if not found then return jsonb_build_object('posted', false, 'reason', 'trip not found'); end if;
  v_co := t.company_id;
  if t.gl_entry is not null then return jsonb_build_object('posted', false, 'reason', 'already posted'); end if;
  if coalesce(t.status,'') <> 'completed' then return jsonb_build_object('posted', false, 'reason', 'trip not completed'); end if;
  if coalesce(t.cancelled_with_booking,false) then return jsonb_build_object('posted', false, 'reason', 'cancelled'); end if;

  select * into b from transport_bookings where id = t.booking_id;
  if not found or b.agent_id is null then return jsonb_build_object('posted', false, 'reason', 'no booking/agent'); end if;

  v_agent := ensure_party_account(v_co, b.agent_id, 'customer');
  v_sales := acct_ensure_named(v_co, 'Transport Sales', 'income', '4', 'Revenue');
  v_sell  := round(coalesce(t.sell_rate, 0), 2);

  if v_agent is not null and v_sales is not null and v_sell > 0 then
    lines := lines || jsonb_build_array(
      jsonb_build_object('account_id', v_agent::text, 'debit', v_sell, 'credit', 0, 'description', 'Transport '||coalesce(b.booking_no,'')||'/'||coalesce(t.seq,0), 'cost_center', v_cc),
      jsonb_build_object('account_id', v_sales::text, 'debit', 0, 'credit', v_sell, 'description', coalesce(t.route_label,'Transport'), 'cost_center', v_cc));
  end if;

  if coalesce(t.is_outsourced,false) and t.vendor_id is not null then
    v_vendor := ensure_transport_vendor_account(v_co, t.vendor_id);
    v_vc := round(coalesce(t.vendor_cost, 0), 2);
    if v_vendor is not null and v_vc > 0 then
      v_cost := acct_ensure_named(v_co, 'Transport Cost', 'expense', '5', 'COGS');
      lines := lines || jsonb_build_array(
        jsonb_build_object('account_id', v_cost::text, 'debit', v_vc, 'credit', 0, 'description', 'Vendor cost '||coalesce(b.booking_no,''), 'cost_center', v_cc),
        jsonb_build_object('account_id', v_vendor::text, 'debit', 0, 'credit', v_vc, 'description', 'Vendor '||coalesce(t.route_label,'')));
    end if;
    -- Vendor collected cash from the passenger on our behalf: reduces both the
    -- vendor payable and the agent receivable.
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

-- Fire when a trip becomes completed. Exception-safe.
create or replace function transport_trip_autopost()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
  if new.status = 'completed' and coalesce(old.status,'') <> 'completed' and new.gl_entry is null then
    begin
      perform transport_trip_post_gl(new.id);
    exception when others then
      get stacked diagnostics v_err = message_text;
      begin insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (new.company_id, auth.uid(), 'transport_autopost_failed', 'transport_trip', new.id, jsonb_build_object('error', v_err));
      exception when others then null; end;
    end;
  end if;
  return new;
end $$;
drop trigger if exists trg_transport_trip_autopost on transport_trips;
create trigger trg_transport_trip_autopost after update on transport_trips
  for each row execute function transport_trip_autopost();

grant execute on function transport_trip_post_gl(uuid) to authenticated;

-- Add transport to the Sales Costing report (revenue = sell, cost = vendor cost).
create or replace function report_sales_costing(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'date' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'source', 'Visa', 'doc_no', vi.doc_no, 'date', vi.doc_date,
      'revenue', vi.sell_amount, 'cost', vi.cost_amount, 'profit', vi.sell_amount - vi.cost_amount,
      'margin', case when vi.sell_amount <> 0 then round((vi.sell_amount - vi.cost_amount) / vi.sell_amount * 100, 1) else 0 end) x
    from visa_invoices vi
    where vi.company_id = auth_company_id()
      and (p_from is null or vi.doc_date >= p_from) and (p_to is null or vi.doc_date <= p_to)
    union all
    select jsonb_build_object(
      'source', 'Transport', 'doc_no', coalesce(b.booking_no,'')||'/'||coalesce(t.seq,0), 'date', t.trip_date,
      'revenue', coalesce(t.sell_rate,0), 'cost', case when t.is_outsourced then coalesce(t.vendor_cost,0) else 0 end,
      'profit', coalesce(t.sell_rate,0) - case when t.is_outsourced then coalesce(t.vendor_cost,0) else 0 end,
      'margin', case when coalesce(t.sell_rate,0) <> 0 then round((coalesce(t.sell_rate,0) - case when t.is_outsourced then coalesce(t.vendor_cost,0) else 0 end) / t.sell_rate * 100, 1) else 0 end)
    from transport_trips t join transport_bookings b on b.id = t.booking_id
    where t.company_id = auth_company_id() and t.gl_entry is not null
      and (p_from is null or t.trip_date >= p_from) and (p_to is null or t.trip_date <= p_to)
  ) t;
$$;

grant execute on function report_sales_costing(date, date) to authenticated;
