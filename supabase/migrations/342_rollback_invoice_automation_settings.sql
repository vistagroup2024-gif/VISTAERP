-- ROLLBACK for 342. Puts the four autopost triggers back to deciding for
-- themselves, and removes the settings table.
--
-- WARNING: running this re-enables automatic invoicing for Transport, Visa,
-- Hotel and Car unconditionally, because that is what the code did before 342.
-- If the intention is only to stop automation, do NOT run this — set the rules
-- to OFF on Accounting -> Invoice Automation instead, which is what they already
-- are. This file exists so 342 is reversible, not because reversing it is wise.
--
-- The posting routines are left reading acct_automation_account() with a
-- fallback, which is harmless once the table is gone... except that it would
-- error. So they are restored to the name-only lookup too.

begin;

create or replace function public.visa_group_autopost()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_err text;
begin
  begin perform visa_invoice_generate(new.id);
  exception when others then
    get stacked diagnostics v_err = message_text;
    begin insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (new.company_id, auth.uid(), 'visa_autopost_failed', 'umrah_group', new.id,
              jsonb_build_object('group_no', new.group_no, 'error', v_err));
    exception when others then null; end;
  end;
  return new;
end $f$;

create or replace function public.transport_trip_autopost()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_err text;
begin
  if new.status = 'completed' and coalesce(old.status,'') <> 'completed' and new.gl_entry is null then
    begin perform transport_trip_post_gl(new.id);
    exception when others then
      get stacked diagnostics v_err = message_text;
      begin insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (new.company_id, auth.uid(), 'transport_autopost_failed', 'transport_trip', new.id,
                jsonb_build_object('error', v_err));
      exception when others then null; end;
    end;
  end if;
  return new;
end $f$;

create or replace function public.hotel_purchase_autopost()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_err text;
begin
  if coalesce(new.vendor_status::text,'') in ('vendor_confirmed','hcn_pending','hcn_received')
     and new.gl_posted_at is null
     and (tg_op = 'INSERT' or coalesce(old.vendor_status::text,'') not in ('vendor_confirmed','hcn_pending','hcn_received')) then
    begin perform hotel_purchase_post_gl(new.id);
    exception when others then
      get stacked diagnostics v_err = message_text;
      begin insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (new.company_id, auth.uid(), 'hotel_autopost_failed', 'hotel_purchase_booking', new.id,
                jsonb_build_object('error', v_err));
      exception when others then null; end;
    end;
  end if;
  return new;
end $f$;

create or replace function public.car_autopost_trigger()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_err text; v_state text; v_ctx text;
begin
  begin
    case tg_argv[0]
      when 'vehicle'        then perform car_post_vehicle(new.id);
      when 'contract'       then perform car_post_contract(new.id);
      when 'receipt'        then perform car_post_receipt(new.id);
      when 'charge'         then perform car_post_charge(new.id);
      when 'charge_payment' then perform car_post_charge_payment(new.id);
      when 'commission'     then perform car_post_commission(new.id);
      else null;
    end case;
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
    raise warning 'car autopost (%) failed for % [%]: % / %', tg_argv[0], new.id, v_state, v_err, v_ctx;
    begin insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (auth_company_id(), auth.uid(), 'car_autopost_failed', tg_argv[0]::text, new.id,
              jsonb_build_object('sqlstate', v_state, 'message', v_err, 'context', v_ctx));
    exception when others then null; end;
  end;
  return null;
end $f$;

-- The three posting routines must stop calling the helpers BEFORE the helpers
-- are dropped, or every transport/visa/hotel posting would raise "function does
-- not exist". Restored here to the name-only lookup they used before 342.
create or replace function public.transport_trip_post_gl(p_trip uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
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
end $f$;

create or replace function public.visa_invoice_post(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare v visa_invoices; v_inc uuid; v_exp uuid; r jsonb; lines jsonb; g jsonb; v_cc text := 'UMRAH VISA';
begin
  select * into v from visa_invoices where id = p_id;
  if not found then return; end if;
  if v.gl_sales_entry is not null or v.gl_purchase_entry is not null then return; end if;
  if v.agent_id is not null and v.sell_amount > 0 then
    v_inc := acct_ensure_named(v.company_id, 'Visa Sales', 'income', '4', 'Revenue');
    if v_inc is not null then
      r := party_invoice(v.company_id, v.agent_id, 'customer', v.doc_date, null,
             coalesce(v.narration, 'Visa ' || coalesce(v.doc_no,'')), v.sell_amount, v_inc, 0, v.doc_no, true, v_cc, null);
      update visa_invoices set gl_sales_entry = (select entry_id from open_items where id = (r->>'open_item_id')::uuid)
        where id = p_id;
    end if;
  end if;
  if v.supplier_account_id is not null and v.cost_amount > 0 then
    v_exp := acct_ensure_named(v.company_id, 'Visa Cost', 'expense', '5', 'COGS');
    if v_exp is not null then
      lines := jsonb_build_array(
        jsonb_build_object('account_id', v_exp::text, 'debit', v.cost_amount, 'credit', 0, 'description', 'Visa cost ' || coalesce(v.doc_no,''), 'cost_center', v_cc),
        jsonb_build_object('account_id', v.supplier_account_id::text, 'debit', 0, 'credit', v.cost_amount, 'description', coalesce(v.haji_name, v.doc_no)));
      g := gl_post(v.company_id, v.doc_date, 'Visa cost ' || coalesce(v.doc_no,''), 'gl_visa_cost', v.doc_no, lines);
      update visa_invoices set gl_purchase_entry = (g->>'entry_id')::uuid where id = p_id;
    end if;
  end if;
  update visa_invoices set status = 'posted', updated_at = now() where id = p_id;
end $f$;

create or replace function public.hotel_purchase_post_gl(p_row uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
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
  v_agent := b.agent_id;
  if v_agent is not null and v_sell > 0 then
    v_inc := acct_ensure_named(v_co, 'Hotel Sales', 'income', '4', 'Revenue');
    if v_inc is not null then
      r := party_invoice(v_co, v_agent, 'customer', coalesce(hp.check_in, current_date), null,
             v_narr, v_sell, v_inc, 0, coalesce(b.booking_no,''), true, v_cc, null);
      v_sales_no := r->>'entry_no';
    end if;
  end if;
  if hp.supplier_id is not null and v_cost > 0 then
    v_exp := acct_ensure_named(v_co, 'Hotel Cost', 'expense', '5', 'COGS');
    if v_exp is not null then
      r := party_invoice(v_co, hp.supplier_id, 'supplier', coalesce(hp.check_in, current_date), null,
             v_narr || ' (cost)', v_cost, v_exp, 0, coalesce(b.booking_no,''), true, v_cc, null);
      v_pur_no := r->>'entry_no';
    end if;
  end if;
  if v_sales_no is null and v_pur_no is null then
    return jsonb_build_object('posted', false, 'reason', 'nothing to post'); end if;
  update hotel_purchase_bookings
    set gl_posted_at = now(), gl_sales_entry = v_sales_no, gl_purchase_entry = v_pur_no where id = p_row;
  return jsonb_build_object('posted', true, 'sell', v_sell, 'cost', v_cost,
    'sales_entry', v_sales_no, 'purchase_entry', v_pur_no);
end $f$;

drop function if exists public.acct_automation_save(uuid, boolean, uuid, uuid, text);
drop function if exists public.acct_automation_list();
drop function if exists public.acct_automation_account(uuid, text, text);
drop function if exists public.acct_automation_enabled(uuid, text);
drop table if exists public.acct_automation_rules;

do $chk$
begin
  if to_regclass('public.acct_automation_rules') is not null then
    raise exception '342 rollback: rules table still present'; end if;
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
       where ns.nspname='public'
         and p.proname in ('visa_group_autopost','transport_trip_autopost','hotel_purchase_autopost','car_autopost_trigger')
         and pg_get_functiondef(p.oid) like '%acct_automation_enabled%') <> 0
  then raise exception '342 rollback: a trigger still references the settings table'; end if;
end $chk$;

commit;
