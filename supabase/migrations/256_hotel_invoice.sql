-- 256_hotel_invoice.sql
-- Auto-post the hotel invoice to the GL per purchase-booking (stay × supplier),
-- when the vendor confirms it (vendor_status reaches vendor_confirmed or beyond).
-- Sale and purchase rates are already stored on the purchase booking:
--   Customer: Dr Agent (receivable) / Cr Hotel Sales = sale_total
--   Supplier: Dr Hotel Cost (COGS)   / Cr Supplier   = purchase_total
-- Cost center 'HOTEL'. Idempotent via gl_posted_at. Feeds Sales Costing.
-- Mirrors the Visa auto-invoice (party_invoice both sides); agents & suppliers
-- are parties, so the party ledgers/open-items are reused as-is.

alter table hotel_purchase_bookings add column if not exists gl_posted_at timestamptz;
alter table hotel_purchase_bookings add column if not exists gl_sales_entry text;
alter table hotel_purchase_bookings add column if not exists gl_purchase_entry text;

create or replace function hotel_purchase_post_gl(p_row uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare hp hotel_purchase_bookings; b hotel_bookings; v_co uuid; v_agent uuid; v_inc uuid; v_exp uuid;
        v_sell numeric(18,2); v_cost numeric(18,2); r jsonb; v_cc text := 'HOTEL'; v_narr text;
        v_sales_no text; v_pur_no text;
begin
  select * into hp from hotel_purchase_bookings where id = p_row;
  if not found then return jsonb_build_object('posted', false, 'reason', 'row not found'); end if;
  v_co := hp.company_id;
  if hp.gl_posted_at is not null then return jsonb_build_object('posted', false, 'reason', 'already posted'); end if;
  if coalesce(hp.vendor_status::text,'') not in ('vendor_confirmed','hcn_pending','hcn_received')
    then return jsonb_build_object('posted', false, 'reason', 'not vendor confirmed'); end if;

  select * into b from hotel_bookings where id = hp.booking_id;
  v_sell := round(coalesce(hp.sale_total, 0), 2);
  v_cost := round(coalesce(hp.purchase_total, 0), 2);
  v_narr := 'Hotel ' || coalesce(b.booking_no,'') || ' — ' || coalesce(hp.hotel_name,'');

  -- Customer (agent) sales: Dr agent / Cr Hotel Sales.
  v_agent := b.agent_id;
  if v_agent is not null and v_sell > 0 then
    v_inc := acct_ensure_named(v_co, 'Hotel Sales', 'income', '4', 'Revenue');
    if v_inc is not null then
      r := party_invoice(v_co, v_agent, 'customer', coalesce(hp.check_in, current_date), null,
             v_narr, v_sell, v_inc, 0, coalesce(b.booking_no,''), true, v_cc, null);
      v_sales_no := r->>'entry_no';
    end if;
  end if;

  -- Supplier bill: Dr Hotel Cost / Cr Supplier.
  if hp.supplier_id is not null and v_cost > 0 then
    v_exp := acct_ensure_named(v_co, 'Hotel Cost', 'expense', '5', 'COGS');
    if v_exp is not null then
      r := party_invoice(v_co, hp.supplier_id, 'supplier', coalesce(hp.check_in, current_date), null,
             v_narr || ' (cost)', v_cost, v_exp, 0, coalesce(b.booking_no,''), true, v_cc, null);
      v_pur_no := r->>'entry_no';
    end if;
  end if;

  if v_sales_no is null and v_pur_no is null then
    return jsonb_build_object('posted', false, 'reason', 'nothing to post');
  end if;

  update hotel_purchase_bookings
    set gl_posted_at = now(), gl_sales_entry = v_sales_no, gl_purchase_entry = v_pur_no
    where id = p_row;
  return jsonb_build_object('posted', true, 'sell', v_sell, 'cost', v_cost,
    'sales_entry', v_sales_no, 'purchase_entry', v_pur_no);
end $$;

-- Fire when a purchase booking becomes vendor-confirmed (or is inserted already
-- confirmed). Exception-safe: never blocks the booking write.
create or replace function hotel_purchase_autopost()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
  if coalesce(new.vendor_status::text,'') in ('vendor_confirmed','hcn_pending','hcn_received')
     and new.gl_posted_at is null
     and (tg_op = 'INSERT' or coalesce(old.vendor_status::text,'') not in ('vendor_confirmed','hcn_pending','hcn_received')) then
    begin
      perform hotel_purchase_post_gl(new.id);
    exception when others then
      get stacked diagnostics v_err = message_text;
      begin insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (new.company_id, auth.uid(), 'hotel_autopost_failed', 'hotel_purchase_booking', new.id,
                jsonb_build_object('error', v_err));
      exception when others then null; end;
    end;
  end if;
  return new;
end $$;
drop trigger if exists trg_hotel_purchase_autopost on hotel_purchase_bookings;
create trigger trg_hotel_purchase_autopost after insert or update on hotel_purchase_bookings
  for each row execute function hotel_purchase_autopost();

grant execute on function hotel_purchase_post_gl(uuid) to authenticated;

-- List hotel invoices (vendor-confirmed purchase bookings) for the screen.
create or replace function hotel_invoice_list(p_from date, p_to date, p_only_unposted boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'date' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'row_id', hp.id, 'doc', coalesce(b.booking_no,''), 'date', hp.check_in,
      'agent', ag.name, 'hotel', hp.hotel_name, 'city', hp.city,
      'sell', coalesce(hp.sale_total,0), 'supplier', sp.name, 'cost', coalesce(hp.purchase_total,0),
      'posted', hp.gl_posted_at is not null) x
    from hotel_purchase_bookings hp
    join hotel_bookings b on b.id = hp.booking_id
    left join parties ag on ag.id = b.agent_id
    left join parties sp on sp.id = hp.supplier_id
    where hp.company_id = auth_company_id()
      and hp.vendor_status::text in ('vendor_confirmed','hcn_pending','hcn_received')
      and (p_from is null or hp.check_in >= p_from) and (p_to is null or hp.check_in <= p_to)
      and (not p_only_unposted or hp.gl_posted_at is null)
  ) t;
$$;
grant execute on function hotel_invoice_list(date, date, boolean) to authenticated;

-- Add hotel to the Sales Costing report (revenue = sale, cost = purchase).
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
    union all
    select jsonb_build_object(
      'source', 'Hotel', 'doc_no', coalesce(hb.booking_no,''), 'date', hp.check_in,
      'revenue', coalesce(hp.sale_total,0), 'cost', coalesce(hp.purchase_total,0),
      'profit', coalesce(hp.sale_total,0) - coalesce(hp.purchase_total,0),
      'margin', case when coalesce(hp.sale_total,0) <> 0 then round((coalesce(hp.sale_total,0) - coalesce(hp.purchase_total,0)) / hp.sale_total * 100, 1) else 0 end)
    from hotel_purchase_bookings hp join hotel_bookings hb on hb.id = hp.booking_id
    where hp.company_id = auth_company_id() and hp.gl_posted_at is not null
      and (p_from is null or hp.check_in >= p_from) and (p_to is null or hp.check_in <= p_to)
  ) t;
$$;
grant execute on function report_sales_costing(date, date) to authenticated;
