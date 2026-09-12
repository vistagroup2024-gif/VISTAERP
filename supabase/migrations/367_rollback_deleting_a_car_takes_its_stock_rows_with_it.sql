-- Rollback of 367 — restores the reversing-issue behaviour on vehicle delete.
--
-- IT CANNOT BRING THE TWO CLEARED ROWS BACK, and nothing here pretends to. 367
-- deleted the receipt and the reversing issue for CAR-000003, a vehicle that no
-- longer existed, along with the stock_balances row they had left reading
-- 0.000 / 0.00. The set netted to zero, so no balance and no GL figure changed
-- with it, and re-inserting invented rows for a car nobody can look up would be
-- worse than the hole. The audit_log row `car_stock_orphans_cleared` is what
-- records that it happened.
--
-- What it does restore is the FUNCTION, exactly as it stood before 367: on
-- delete, `stock_apply('issue', ..., 1, 0, ..., 'Vehicle X deleted')` and the
-- original receipt left standing. Be clear about what that means before running
-- it — it puts back the behaviour that let a deleted car leave two rows in the
-- stock ledger, which is the whole reason 367 exists.

begin;

create or replace function public.car_vehicle_stock_release()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_err text; v_state text; v_ctx text;
begin
  if old.stock_product_id is not null then
    begin
      perform stock_apply(old.company_id, 'issue', old.stock_product_id,
        car_stock_warehouse(old.company_id), 1, 0, current_date, old.vehicle_no,
        'Vehicle ' || old.vehicle_no || ' deleted');
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
      raise warning 'car stock release (%) failed [%]: % / %', old.id, v_state, v_err, v_ctx;
      begin
        insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
        values (old.company_id, auth.uid(), 'car_stock_release_failed', 'car_vehicle', old.id,
                jsonb_build_object('sqlstate', v_state, 'message', v_err, 'context', v_ctx));
      exception when others then null; end;
    end;
  end if;
  return old;
end $function$;

revoke all on function public.car_vehicle_stock_release() from public, anon;

do $chk$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'car_vehicle_stock_release';

  if v_def !~* 'stock_apply' then
    raise exception '367 rollback: the reversing issue was not restored';
  end if;
  if v_def ~* 'delete +from +stock_movements' then
    raise exception '367 rollback: the function still deletes movements';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'car_vehicles' and t.tgname = 'trg_car_vehicle_stock_delete'
       and not t.tgisinternal
  ) then
    raise exception '367 rollback: trg_car_vehicle_stock_delete is gone';
  end if;

  raise notice '367 rollback ok: the reversing issue is back';
end
$chk$;

commit;
