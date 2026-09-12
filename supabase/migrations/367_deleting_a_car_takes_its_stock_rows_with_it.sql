-- Deleting a car takes its stock rows with it, and the two it already left
-- behind are cleared.
--
-- WHAT WENT WRONG. There are two unpost rules in this ERP and only one of them
-- cleaned up after itself:
--
--   trade_doc_unpost          walks `stock_movements where reference = d.doc_no`,
--                             unwinds the balance and DELETES each movement.
--   car_vehicle_stock_release wrote a REVERSING ISSUE instead — stock_apply
--                             ('issue', ..., 1, 0, ..., 'Vehicle X deleted') —
--                             and left the original receipt standing.
--
-- A car's movements carry `reference = vehicle_no`, never the document number,
-- so trade_doc_unpost never saw them: deleting the Purchase Voucher a car came
-- from removed the voucher's own rows and left the car's two behind. That is how
-- the stock ledger came to hold a receipt and an issue for CAR-000003 after
-- every journal, trade document, vehicle and contract in the database had been
-- deleted — the whole of `stock_movements`, with net quantity zero and a
-- stock_balances row reading 0.000 / 0.00.
--
-- Both those rows were written in ONE transaction, which is the sequence worth
-- keeping in mind: trade_doc_unpost undoes the sale first (car_return_undo /
-- the contract going away puts the vehicle back to in_stock, so
-- car_vehicle_stock_sync RECEIPTS it in again), then deletes the vehicle, which
-- fired the release and ISSUED it back out. A car that was already sold and
-- gone got a fresh pair of movements on its way to being deleted.
--
-- THE FIX, as chosen: the vehicle path now follows the trade path. Its own
-- movements are deleted and the balance unwound, so a deleted car leaves no
-- trace — one convention across the ERP instead of two.
--
-- It also removes the stock_balances row when the last movement for that
-- item/warehouse goes, which trade_doc_unpost does not do. A balance row with
-- no movement behind it has nothing to be the balance OF, and leaving zeroes
-- lying about is what made this hard to read in the first place.
--
-- WHAT IS DELIBERATELY KEPT. The trigger still cannot refuse. It is BEFORE
-- DELETE on car_vehicles and the old body swallowed any failure into a warning
-- and an audit row precisely so a stock problem could not make a vehicle
-- undeletable; that stays, and the new body is wrapped the same way. And it
-- still reads `old.company_id` / `old.vehicle_no` rather than trusting a
-- session, because a trigger has no caller.
--
-- THE ONE-OFF CLEANUP IS PROVED SAFE RATHER THAN ASSUMED. It only removes a set
-- of movements that nets to zero against a balance row already reading zero, so
-- there is no balance arithmetic to get wrong: if what is deleted sums to
-- nothing, deleting it changes nothing. Anything that does not satisfy that is
-- left alone and the migration aborts. It is scoped to movements whose
-- reference names a vehicle that no longer exists — a manually entered stock
-- movement is never touched, which is why this is not written as "any movement
-- with no document behind it".

begin;

-- ---------------------------------------------------------------------------
-- 1. The trigger function.
-- ---------------------------------------------------------------------------
create or replace function public.car_vehicle_stock_release()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  mv       record;
  v_signed numeric(18,2);
  v_left   int;
  v_n      int := 0;
  v_err    text; v_state text; v_ctx text;
begin
  begin
    -- Same walk as trade_doc_unpost, keyed on the vehicle instead of the
    -- document. Newest first, so a receipt is never removed before the issue
    -- that consumed it.
    for mv in
      select * from stock_movements
       where company_id = old.company_id
         and reference  = old.vehicle_no
       order by created_at desc, qty asc
    loop
      -- `value` is stored unsigned; the sign of the movement is on `qty`.
      v_signed := case when mv.qty < 0 then -mv.value else mv.value end;

      update stock_balances
         set qty   = qty - mv.qty,
             value = value - v_signed
       where company_id   = old.company_id
         and item_id      = mv.item_id
         and warehouse_id = mv.warehouse_id;

      delete from stock_movements where id = mv.id;
      v_n := v_n + 1;

      -- A balance row with no movements left behind it is not a balance.
      select count(*) into v_left from stock_movements
       where company_id   = old.company_id
         and item_id      = mv.item_id
         and warehouse_id = mv.warehouse_id;

      if v_left = 0 then
        delete from stock_balances
         where company_id   = old.company_id
           and item_id      = mv.item_id
           and warehouse_id = mv.warehouse_id;
      end if;
    end loop;

    if v_n > 0 then
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (old.company_id, auth.uid(), 'car_stock_released', 'car_vehicle', old.id,
              jsonb_build_object('vehicle_no', old.vehicle_no,
                                 'movements_removed', v_n));
    end if;
  exception when others then
    -- A stock problem must not make a vehicle undeletable. Unchanged.
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
    raise warning 'car stock release (%) failed [%]: % / %', old.id, v_state, v_err, v_ctx;
    begin
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (old.company_id, auth.uid(), 'car_stock_release_failed', 'car_vehicle', old.id,
              jsonb_build_object('sqlstate', v_state, 'message', v_err, 'context', v_ctx));
    exception when others then null; end;
  end;

  return old;
end $function$;

-- An internal trigger function. It is not granted, and it is not callable.
revoke all on function public.car_vehicle_stock_release() from public, anon;

-- ---------------------------------------------------------------------------
-- 2. The two rows already standing. Only a set that nets to zero is removed.
-- ---------------------------------------------------------------------------
do $clean$
declare
  v_orphans  int;
  v_bad      text;
  v_mov      int;
  v_bal      int;
begin
  create temp table _367_orphans on commit drop as
  select m.*
    from stock_movements m
   where m.reference like 'CAR-%'
     and m.narration like 'Vehicle %'
     and not exists (select 1 from car_vehicles v
                      where v.company_id = m.company_id
                        and v.vehicle_no = m.reference);

  select count(*) into v_orphans from _367_orphans;
  raise notice '367: % orphaned car movement(s)', v_orphans;

  if v_orphans = 0 then
    raise notice '367: nothing to clean';
    return;
  end if;

  -- Every (company, item, warehouse) being emptied must net to zero, and the
  -- balance row must already read zero. Otherwise this is live stock and not
  -- an artefact of a deleted vehicle, and the arithmetic would be somebody's.
  select string_agg(format('%s qty %s / balance %s', t.item_id, t.moved, t.bal), '; ')
    into v_bad
    from (
      select o.item_id, o.warehouse_id,
             sum(o.qty) as moved,
             coalesce((select b.qty from stock_balances b
                        where b.company_id   = o.company_id
                          and b.item_id      = o.item_id
                          and b.warehouse_id = o.warehouse_id), 0) as bal
        from _367_orphans o
       group by o.company_id, o.item_id, o.warehouse_id
    ) t
   where t.moved <> 0 or t.bal <> 0;

  if v_bad is not null then
    raise exception '367: refusing — these do not net to zero: %', v_bad;
  end if;

  -- Also refuse if any of them is carrying a GL entry: then it is posted stock
  -- and removing it silently would leave the ledger claiming goods.
  select count(*) into v_mov from _367_orphans where gl_entry is not null;
  if v_mov > 0 then
    raise exception '367: refusing — % orphan(s) carry a GL entry', v_mov;
  end if;

  delete from stock_movements m using _367_orphans o where m.id = o.id;
  get diagnostics v_mov = row_count;

  delete from stock_balances b
   where b.qty = 0 and b.value = 0
     and not exists (select 1 from stock_movements m
                      where m.company_id   = b.company_id
                        and m.item_id      = b.item_id
                        and m.warehouse_id = b.warehouse_id);
  get diagnostics v_bal = row_count;

  raise notice '367: removed % movement(s) and % empty balance row(s)', v_mov, v_bal;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  select distinct o.company_id, auth.uid(), 'car_stock_orphans_cleared', 'stock_movement', null::uuid,
         jsonb_build_object('movements', v_mov, 'balances', v_bal,
                            'reason', 'vehicle no longer exists; set netted to zero')
    from _367_orphans o;
end
$clean$;

-- ---------------------------------------------------------------------------
-- 3. Post-conditions.
-- ---------------------------------------------------------------------------
do $chk$
declare
  v_orphans int;
  v_neg     int;
  v_dangle  int;
  v_def     text;
  v_j       int;
  v_stock   int;
begin
  -- no orphaned car movement is left
  select count(*) into v_orphans
    from stock_movements m
   where m.reference like 'CAR-%'
     and m.narration like 'Vehicle %'
     and not exists (select 1 from car_vehicles v
                      where v.company_id = m.company_id and v.vehicle_no = m.reference);
  if v_orphans <> 0 then
    raise exception '367: % orphaned car movement(s) still standing', v_orphans;
  end if;

  -- nothing went negative, and no balance row is left without movements
  select count(*) into v_neg from stock_balances where qty < 0;
  if v_neg <> 0 then raise exception '367: % balance row(s) went negative', v_neg; end if;

  select count(*) into v_dangle
    from stock_balances b
   where not exists (select 1 from stock_movements m
                      where m.company_id = b.company_id
                        and m.item_id = b.item_id
                        and m.warehouse_id = b.warehouse_id);
  if v_dangle <> 0 then
    raise exception '367: % balance row(s) have no movements behind them', v_dangle;
  end if;

  -- the trigger no longer writes a reversing issue, and does delete
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'car_vehicle_stock_release';
  if v_def ~* 'stock_apply' then
    raise exception '367: the release trigger still calls stock_apply';
  end if;
  if v_def !~* 'delete +from +stock_movements' then
    raise exception '367: the release trigger does not delete movements';
  end if;
  if v_def !~* 'raise warning' then
    raise exception '367: the release trigger lost its non-blocking handler';
  end if;

  -- the trigger is still attached, still BEFORE DELETE
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'car_vehicles' and t.tgname = 'trg_car_vehicle_stock_delete'
       and not t.tgisinternal
  ) then
    raise exception '367: trg_car_vehicle_stock_delete is gone';
  end if;

  -- this migration touches stock rows and nothing else
  select count(*) into v_j from journal_entries;
  if v_j <> 0 then raise exception '367: % journal entr(ies) appeared', v_j; end if;

  select count(*) into v_stock from acct_products where is_stock;
  if v_stock <> 39 then
    raise exception '367: % stock item(s), expected the 39 from 366', v_stock;
  end if;

  raise notice '367 ok: stock ledger holds % movement(s)', (select count(*) from stock_movements);
end
$chk$;

commit;
