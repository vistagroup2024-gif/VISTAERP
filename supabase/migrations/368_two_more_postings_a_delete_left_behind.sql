-- Two more postings a delete left behind, found by sweeping the rest of the ERP
-- for the shape 367 fixed. Both are in Car Sales. Nothing in Umrah is touched.
--
-- WHAT THE SWEEP LOOKED FOR AND WHAT IT FOUND. 367's bug was a delete path that
-- did not clean up after itself. Reading every routine whose name says delete,
-- unpost, cancel, release, undo or remove: no other one writes a reversing
-- entry the way car_vehicle_stock_release did — that was unique. But two delete
-- paths simply never unpost at all:
--
--   1. car_vehicle_delete removes the vehicle and LEAVES ITS PURCHASE ENTRY.
--      car_post_vehicle posts Dr 1160 Vehicle Inventory / Cr 2100 keyed
--      (source 'car_purchase', reference vehicle_no) for any vehicle entered by
--      hand. Delete that vehicle and the entry stands for ever: inventory
--      debited and a payable credited for a car that does not exist. The guard
--      trigger already refuses a vehicle that carries EXPENSE vouchers, with
--      the words "each one has a ledger entry that would otherwise be left
--      behind" — the vehicle's own entry was the case nobody covered.
--
--   2. car_contract_cancel LEAVES THE SALE ENTRY. car_post_contract posts
--      Dr customer / Cr 4200 Vehicle Sales / Dr 5100 / Cr 1160 keyed
--      (source 'car_sale', reference contract_no). Cancel sets status to
--      'cancelled' and nothing else. The autopost trigger only ever POSTS — it
--      fires on status and car_post_contract returns false for a cancelled
--      contract, so it does not post again, and it never removes what is
--      already there. THE CUSTOMER STAYS DEBITED FOR A CANCELLED INVOICE, and
--      "what does this customer owe" answers with a sale that was called off.
--
-- THE FIX REUSES WHAT IS THERE. car_contract_unpost already deletes the
-- car_sale and car_advance entries and carries every refusal that matters —
-- receipts taken, an instalment or monthly charge part-paid, a commission paid,
-- the invoice loaded into a trade document. Cancel simply never called it. It
-- does now, before the status changes, so a refusal stops the cancellation
-- rather than half-finishing it.
--
-- THE VEHICLE FIX GOES IN A TRIGGER, NOT IN car_vehicle_delete, and that is
-- deliberate: the RPC is not the only way a vehicle row goes away —
-- trade_doc_unpost deletes vehicles directly (`delete from car_vehicles where
-- source_trade_doc = p_id`). A BEFORE DELETE trigger covers every path, the way
-- car_vehicle_stock_release covers every path for stock. For a vehicle that
-- came from a Purchase Voucher it is a no-op, because car_post_vehicle refuses
-- to post one of those in the first place (`if v.source_trade_doc is not null
-- then return false`) — the voucher posts it instead.
--
-- UNLIKE THE STOCK RELEASE, THIS ONE REFUSES. The stock trigger swallows a
-- failure into a warning so a stock problem cannot make a vehicle undeletable.
-- Money is not the same: if the purchase is part of a payment that has been
-- allocated, deleting the entry would leave the payment pointing at nothing. So
-- it raises, in the same words and for the same reason as the expense guard
-- beside it, and the vehicle stays until the payment is dealt with.

begin;

-- ---------------------------------------------------------------------------
-- 1. A vehicle's own purchase entry goes with the vehicle.
-- ---------------------------------------------------------------------------
create or replace function public.car_vehicle_gl_release()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids  uuid[];
  v_nos  text;
  v_paid text;
begin
  select array_agg(id), string_agg(entry_no, ', ' order by entry_no)
    into v_ids, v_nos
    from journal_entries
   where company_id = old.company_id
     and source     = 'car_purchase'
     and reference  = old.vehicle_no;

  if v_ids is null then
    return old;                      -- nothing was posted for this vehicle
  end if;

  -- Money that has been allocated against it is somebody's decision, not this
  -- trigger's. Same rule, and the same wording, as the expense guard.
  select string_agg(distinct o.doc_no, ', ') into v_paid
    from open_items o
    join allocations a on a.open_item_id = o.id
   where o.entry_id = any(v_ids);

  if v_paid is not null then
    raise exception 'Car % has payments allocated against its purchase entry (%). Clear those first — deleting it now would leave the payment pointing at nothing.',
      old.vehicle_no, v_paid;
  end if;

  delete from open_items     where entry_id = any(v_ids);
  delete from journal_lines  where entry_id = any(v_ids);
  delete from journal_entries where id = any(v_ids);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (old.company_id, auth.uid(), 'car_vehicle_gl_released', 'car_vehicle', old.id,
          jsonb_build_object('vehicle_no', old.vehicle_no, 'entries', v_nos,
                             'entries_removed', array_length(v_ids, 1)));

  return old;
end $function$;

revoke all on function public.car_vehicle_gl_release() from public, anon;

-- Named so it fires before the guard and the stock release; all three are
-- BEFORE DELETE and Postgres runs them in name order.
drop trigger if exists trg_car_vehicle_gl_delete on car_vehicles;
create trigger trg_car_vehicle_gl_delete
  before delete on car_vehicles
  for each row execute function car_vehicle_gl_release();

-- ---------------------------------------------------------------------------
-- 2. Cancelling a Car Invoice unposts it.
-- ---------------------------------------------------------------------------
create or replace function public.car_contract_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_vehicle uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  -- Before anything changes. car_contract_unpost carries the refusals — a
  -- receipt taken, an instalment or charge part-paid, a commission paid, the
  -- invoice already loaded into a trade document — so any of those stops the
  -- cancellation here instead of leaving it half done.
  perform car_contract_unpost(p_id, 'contract cancelled');

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

-- ---------------------------------------------------------------------------
-- 3. Post-conditions.
-- ---------------------------------------------------------------------------
do $chk$
declare v_def text; v_n int;
begin
  -- the cancel now unposts, and still does everything it did before
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'car_contract_cancel';
  if v_def !~ 'car_contract_unpost' then
    raise exception '368: cancel does not unpost';
  end if;
  if v_def !~ 'not cancellable' or v_def !~ 'car_contract_cancelled' then
    raise exception '368: cancel lost its refusal or its audit row';
  end if;
  if v_def !~ 'current_customer_id = null' then
    raise exception '368: cancel no longer frees the vehicle';
  end if;

  -- the vehicle trigger exists, is BEFORE DELETE, and refuses rather than warns
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'car_vehicle_gl_release';
  if v_def !~ 'car_purchase' then
    raise exception '368: the vehicle release does not look for a car_purchase entry';
  end if;
  if v_def !~ 'raise exception' then
    raise exception '368: the vehicle release does not refuse an allocated payment';
  end if;

  select count(*) into v_n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'car_vehicles' and not t.tgisinternal
     and t.tgname in ('trg_car_vehicle_gl_delete', 'trg_car_vehicle_guard_delete',
                      'trg_car_vehicle_stock_delete');
  if v_n <> 3 then
    raise exception '368: % of the 3 delete triggers on car_vehicles are attached', v_n;
  end if;

  -- the gl trigger must sort before the guard and the stock release, or a
  -- refusal from one of those would come first and the ordering claim is void
  if not ('trg_car_vehicle_gl_delete' < 'trg_car_vehicle_guard_delete'
      and 'trg_car_vehicle_gl_delete' < 'trg_car_vehicle_stock_delete') then
    raise exception '368: the trigger name does not sort first';
  end if;

  -- and nothing was posted or moved by this migration
  select count(*) into v_n from journal_entries;
  if v_n <> 0 then raise exception '368: % journal entr(ies) appeared', v_n; end if;
  select count(*) into v_n from stock_movements;
  if v_n <> 0 then raise exception '368: % stock movement(s) appeared', v_n; end if;

  raise notice '368 ok';
end
$chk$;

commit;
