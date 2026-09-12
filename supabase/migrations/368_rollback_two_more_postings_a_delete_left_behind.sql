-- Rollback of 368 — puts back the two delete paths that left a posting behind.
--
-- Read that sentence before running it. This restores the behaviour where
-- deleting a hand-entered vehicle leaves its Dr 1160 / Cr 2100 purchase entry
-- in the ledger for ever, and cancelling a Car Invoice leaves the customer
-- debited for a sale that was called off.
--
-- Nothing needs undoing in the data: 368 changed two routines and added one
-- trigger, and posted, moved and deleted nothing. It was applied while
-- journal_entries and stock_movements were both empty.

begin;

drop trigger if exists trg_car_vehicle_gl_delete on car_vehicles;
drop function if exists public.car_vehicle_gl_release();

-- car_contract_cancel exactly as it stood before 368.
create or replace function public.car_contract_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_vehicle uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  update car_contracts set status = 'cancelled', updated_at = now()
  where id = p_id and company_id = v_company and status in ('draft','active') returning vehicle_id into v_vehicle;
  if v_vehicle is null then raise exception 'Contract not found or not cancellable.'; end if;
  update car_vehicles set status = case when status in ('reserved','sold') then 'in_stock' else status end,
    current_customer_id = null, contract_id = null
  where id = v_vehicle and status in ('reserved','sold');
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_contract_cancelled', 'car_contract', p_id, '{}'::jsonb);
end $function$;

revoke all on function public.car_contract_cancel(uuid) from public, anon;
grant execute on function public.car_contract_cancel(uuid) to authenticated;

do $chk$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'car_contract_cancel';
  if v_def ~ 'car_contract_unpost' then
    raise exception '368 rollback: cancel still unposts';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'car_vehicle_gl_release') then
    raise exception '368 rollback: car_vehicle_gl_release is still there';
  end if;
  raise notice '368 rollback ok';
end
$chk$;

commit;
