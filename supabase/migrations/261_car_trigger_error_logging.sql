-- 261_car_trigger_error_logging.sql
-- The two car automation triggers (258, 259) caught every exception and threw it
-- away, so a failure to create the stock vehicle or to generate monthly charges
-- was invisible: the Purchase Voucher / Car Invoice saved fine and the follow-on
-- record simply never appeared. Keep them non-blocking — a broken automation must
-- never stop the user's voucher from saving — but record why they failed.
--
-- Follows the existing autopost convention (243 / 254 / 256): capture the error
-- with GET STACKED DIAGNOSTICS, write an audit_log row, and guard the log insert
-- itself so logging can never block the write either. A RAISE WARNING is added on
-- top so the reason also reaches the Postgres log, which survives even if the
-- surrounding transaction later rolls back and takes the audit_log row with it.

-- Vehicle creation from a posted car Purchase Voucher (259).
create or replace function car_pv_vehicle_autocreate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text; v_state text; v_ctx text;
begin
  if new.gl_entry is not null and coalesce(old.gl_entry, '00000000-0000-0000-0000-000000000000'::uuid) is distinct from new.gl_entry
     and new.doc_type = 'purchase_voucher'
     and upper(btrim(coalesce(new.cost_center,''))) in ('CAR SALES INSTALLMENT','CAR TRADING') then
    begin
      perform car_vehicle_from_trade_doc(new.id);
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
      raise warning 'car_vehicle_autocreate failed for trade_document % (%): % [%]', new.id, new.doc_no, v_err, v_state;
      begin
        insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (new.company_id, auth.uid(), 'car_vehicle_autocreate_failed', 'trade_document', new.id,
                jsonb_build_object('error', v_err, 'sqlstate', v_state, 'context', v_ctx,
                                   'doc_no', new.doc_no, 'cost_center', new.cost_center));
      exception when others then null; end;
    end;
  end if;
  return new;
end $$;

-- Monthly service-charge generation when a Car Invoice becomes active (258).
create or replace function car_contract_autocharge()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text; v_state text; v_ctx text;
begin
  if new.status = 'active' and coalesce(old.status::text, '') is distinct from 'active' then
    begin
      perform car_gen_charges_vehicle(new.vehicle_id, current_date, new.id, new.customer_id);
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
      raise warning 'car_autocharge failed for car_contract % (%): % [%]', new.id, new.contract_no, v_err, v_state;
      begin
        insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (new.company_id, auth.uid(), 'car_autocharge_failed', 'car_contract', new.id,
                jsonb_build_object('error', v_err, 'sqlstate', v_state, 'context', v_ctx,
                                   'contract_no', new.contract_no, 'vehicle_id', new.vehicle_id));
      exception when others then null; end;
    end;
  end if;
  return new;
end $$;
