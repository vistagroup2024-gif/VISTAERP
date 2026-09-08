-- A Car Invoice carries a discount, and stays editable after it is raised.
--
-- Two things were wrong with a saved Car Invoice.
--
-- 1. THE PRICE HAD NO DISCOUNT. There was one number, sale_price, and it was
--    both what was agreed and what the customer owes. A discount had to be
--    typed into the price itself, which loses the fact that a discount was
--    given at all.
--
-- 2. IT LOCKED THE MOMENT IT WAS SAVED. car_contract_save sets a new invoice to
--    'active' on the way out, and then refuses any contract that is not
--    'draft'. So the very first save finalised it, and "use adjustments to
--    change it" pointed at a screen that cannot change a price.
--
-- THE DISCOUNT
-- ------------
-- sale_price keeps its meaning: the price agreed before any discount. The new
-- discount column comes off it, and net_payable is the two of them, generated
-- so nothing can compute it differently:
--
--     net_payable = sale_price - discount
--
-- net_payable is what the customer owes, so it is what everything that means
-- "what the customer owes" now reads — the receivable and the sale in the GL,
-- the instalment balance, the outstanding on every car report, the dashboard
-- car card, and the base a percentage commission is worked out on. sale_price
-- survives for the agreement, which shows both, and for anything that means the
-- agreed price rather than the balance.
--
-- Existing invoices get discount = 0, so net_payable equals sale_price and not
-- one figure anywhere moves.
--
-- EDITING ONE
-- -----------
-- Same shape as a trade voucher under migration 315, and for the same reason: a
-- Car Invoice posts on save, so changing one has to undo what it did first.
-- car_contract_unpost removes the car_sale and car_advance entries; the save
-- then re-posts from what was typed, in one transaction. It needs the Edit/
-- Delete Posted right on the Car Invoice screen, read through
-- staff_doc_right_strict, so a blank profile does not arrive holding it.
--
-- What it refuses, and why: an invoice can undo what IT did, not what was done
-- on top of it. A receipt taken against it, an instalment or monthly charge
-- part-paid, a commission already paid, or a document raised from it all have
-- to be dealt with first. Each refusal says which.
--
-- Requires 315 (staff_require_doc_strict). Reversible: see the rollback.

-- ----------------------------------------------------------------- price ----

alter table car_contracts add column if not exists discount numeric(18,2) not null default 0;

-- Added only if absent — never dropped and re-added, which on a table that
-- already had one would throw the column away rather than reuse it.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'car_contracts' and column_name = 'net_payable')
  then
    alter table car_contracts add column net_payable numeric(18,2)
      generated always as (sale_price - discount) stored;
  end if;
end $$;

comment on column car_contracts.discount is
  'Off the agreed price. net_payable = sale_price - discount, and net_payable is what the customer owes.';

-- --------------------------------------------------------------- posting ----
-- The receivable and the sale both take the NET. Cost of sale is untouched: a
-- discount changes what we are paid, not what the vehicle cost us.

create or replace function car_post_contract(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare c car_contracts; n boolean := false;
begin
  select * into c from car_contracts where id = p_id;
  if not found or c.status not in ('active','completed') then return false; end if;
  perform car_ensure_accounts(c.company_id);
  n := car_post_entry(c.company_id, c.contract_date, 'Vehicle sale ' || c.contract_no, 'car_sale', c.contract_no,
    jsonb_build_array(
      jsonb_build_object('code','1150','debit',c.net_payable),
      jsonb_build_object('code','4200','credit',c.net_payable),
      jsonb_build_object('code','5100','debit',c.purchase_cost),
      jsonb_build_object('code','1160','credit',c.purchase_cost)));
  if coalesce(c.advance,0) > 0 then
    n := car_post_entry(c.company_id, c.contract_date, 'Advance ' || c.contract_no, 'car_advance', c.contract_no,
      jsonb_build_array(jsonb_build_object('code','1000','debit',c.advance),
                        jsonb_build_object('code','1150','credit',c.advance))) or n;
  end if;
  return n;
end $function$;

-- ---------------------------------------------------------------- unpost ----

create or replace function car_contract_unpost(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  c        car_contracts;
  v_co     uuid := auth_company_id();
  v_block  text;
  v_nos    text;
  v_count  int := 0;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  select * into c from car_contracts where id = p_id and company_id = v_co;
  if not found then raise exception 'Car Invoice not found'; end if;

  -- 1. Money already taken against it. The receipt is its own voucher and has
  --    to be reversed on its own screen first.
  select string_agg(r.receipt_no, ', ' order by r.receipt_no) into v_block
  from car_receipts r where r.contract_id = p_id;
  if v_block is not null then
    raise exception 'Receipt % has been taken against %. Reverse it first, then this invoice can be changed.', v_block, c.contract_no;
  end if;

  -- 2. An instalment or a monthly charge that has been part-paid.
  if exists (select 1 from car_installments i where i.contract_id = p_id and coalesce(i.paid_amount,0) > 0) then
    raise exception 'An instalment on % has already been part-paid. Reverse that receipt first.', c.contract_no;
  end if;
  if exists (select 1 from car_service_charges s where s.contract_id = p_id and coalesce(s.paid_amount,0) > 0) then
    raise exception 'A monthly charge on % has already been part-paid. Reverse that receipt first.', c.contract_no;
  end if;

  -- 3. A commission already paid out on this sale.
  if exists (select 1 from car_commissions m where m.contract_id = p_id and m.paid) then
    raise exception 'The commission on % has already been paid. Undo that first.', c.contract_no;
  end if;

  -- 4. Anything raised FROM this invoice — a car return, a delivery note.
  select string_agg(t.doc_no, ', ' order by t.doc_no) into v_block
  from trade_documents t where t.company_id = v_co and t.source_car_contract = p_id;
  if v_block is not null then
    raise exception '% has already been loaded into %. Delete that first.', c.contract_no, v_block;
  end if;

  -- The two entries this invoice posts, and nothing else. Keyed the way
  -- car_post_entry writes them, so re-posting afterwards is a clean insert.
  select string_agg(entry_no, ', ' order by entry_no), count(*)
    into v_nos, v_count
  from journal_entries
  where company_id = v_co and source in ('car_sale','car_advance') and reference = c.contract_no;

  delete from journal_lines where entry_id in (
    select id from journal_entries
    where company_id = v_co and source in ('car_sale','car_advance') and reference = c.contract_no);
  delete from journal_entries
  where company_id = v_co and source in ('car_sale','car_advance') and reference = c.contract_no;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'car_invoice_unpost', 'car_contract', p_id,
          jsonb_build_object('contract_no', c.contract_no, 'entries', v_nos,
                             'sale_price', c.sale_price, 'discount', c.discount,
                             'net_payable', c.net_payable, 'advance', c.advance,
                             'reason', p_reason));

  return jsonb_build_object('unposted', v_count > 0, 'entries', v_nos, 'entries_removed', v_count);
end $function$;

-- Internal engine: reachable only through car_contract_save / car_contract_delete,
-- which carry the rights check.
revoke all on function car_contract_unpost(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ save ----

create or replace function car_contract_save(p_id uuid, p_header jsonb, p_installments jsonb)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_company uuid := auth_company_id(); v_id uuid; v_no text;
  v_vehicle uuid := nullif(p_header->>'vehicle_id','')::uuid;
  v_sale numeric := coalesce(nullif(p_header->>'sale_price','')::numeric, 0);
  v_disc numeric := coalesce(nullif(p_header->>'discount','')::numeric, 0);
  v_net  numeric;
  v_adv  numeric := coalesce(nullif(p_header->>'advance','')::numeric, 0);
  v_sched numeric; v_cost numeric; it jsonb; i int := 0; v_status car_contract_status;
  v_keep boolean := coalesce((p_header->>'keep_vista')::boolean, true);
  v_new boolean := p_id is null;
  v_old_vehicle uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if v_vehicle is null then raise exception 'Select a vehicle'; end if;
  if nullif(p_header->>'customer_id','') is null then raise exception 'Select a customer'; end if;
  if v_disc < 0 then raise exception 'A discount cannot be negative.'; end if;
  if v_disc > v_sale then raise exception 'The discount (%) is more than the sale price (%).', round(v_disc,2), round(v_sale,2); end if;

  v_net := round(v_sale - v_disc, 2);

  -- Advance + instalments settle the NET, which is what the customer owes.
  v_sched := coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(p_installments,'[]'::jsonb)) e), 0);
  if round(v_adv + v_sched, 2) <> v_net then
    raise exception 'Advance (%) + installments (%) = % but must equal the net payable % (sale price % less discount %); difference %.',
      round(v_adv,2), round(v_sched,2), round(v_adv+v_sched,2), v_net, round(v_sale,2), round(v_disc,2), round(v_net-(v_adv+v_sched),2);
  end if;

  if v_new then
    if exists (select 1 from car_contracts where vehicle_id = v_vehicle and status in ('draft','active')) then
      raise exception 'This vehicle already has an active car invoice.';
    end if;
    select total_cost into v_cost from car_vehicles where id = v_vehicle and company_id = v_company;
    v_no := 'CI-' || lpad(nextval('car_contract_seq')::text, 6, '0');
    insert into car_contracts(company_id, contract_no, customer_id, vehicle_id, purchase_cost, created_by)
    values (v_company, v_no, (p_header->>'customer_id')::uuid, v_vehicle, coalesce(v_cost,0), auth.uid())
    returning id into v_id;
  else
    v_id := p_id;
    select status, vehicle_id into v_status, v_old_vehicle
      from car_contracts where id = v_id and company_id = v_company;
    if v_status is null then raise exception 'Car Invoice not found'; end if;
    if v_status = 'cancelled' then raise exception 'This car invoice is cancelled and cannot be changed.'; end if;
    -- A raised invoice is already in the ledger. Undo it, and let the re-post
    -- at the end put back what was actually typed. One transaction, so a
    -- refusal from car_contract_unpost leaves the invoice exactly as it was.
    if v_status <> 'draft' then
      perform staff_require_doc_strict('car_invoice', 'edit_posted');
      perform car_contract_unpost(v_id, 'edited');
    end if;
    -- Moved to a different vehicle: the one it is leaving goes back on the shelf.
    if v_old_vehicle is not null and v_old_vehicle <> v_vehicle then
      if exists (select 1 from car_contracts where vehicle_id = v_vehicle and id <> v_id and status in ('draft','active')) then
        raise exception 'That vehicle already has an active car invoice.';
      end if;
      update car_vehicles set
        status = case when status in ('sold','reserved','delivered') then 'in_stock' else status end,
        current_customer_id = null, contract_id = null, ownership = 'vista'
      where id = v_old_vehicle and company_id = v_company;
      select total_cost into v_cost from car_vehicles where id = v_vehicle and company_id = v_company;
      update car_contracts set purchase_cost = coalesce(v_cost, 0) where id = v_id;
    end if;
  end if;

  update car_contracts set
    customer_id  = (p_header->>'customer_id')::uuid,
    vehicle_id   = v_vehicle,
    contract_date = coalesce(nullif(p_header->>'contract_date','')::date, contract_date),
    advance_due_date = nullif(p_header->>'advance_due_date','')::date,
    cost_center  = nullif(p_header->>'cost_center',''),
    tag_area     = nullif(p_header->>'tag_area',''),
    sale_price   = v_sale,
    discount     = v_disc,
    advance      = v_adv,
    reference_name = nullif(p_header->>'reference_name',''),
    salesperson  = nullif(p_header->>'salesperson',''),
    notes        = nullif(p_header->>'notes',''),
    updated_at   = now()
  where id = v_id and company_id = v_company;

  delete from car_installments where contract_id = v_id;
  for it in select * from jsonb_array_elements(coalesce(p_installments,'[]'::jsonb)) loop
    i := i + 1;
    insert into car_installments(contract_id, inst_no, due_date, amount, notes)
    values (v_id, i, (it->>'due_date')::date, coalesce(nullif(it->>'amount','')::numeric,0), nullif(it->>'notes',''));
  end loop;

  update car_contracts set expected_completion_date = (select max(due_date) from car_installments where contract_id = v_id)
  where id = v_id;

  update car_vehicles set
    current_customer_id = (p_header->>'customer_id')::uuid, contract_id = v_id,
    status = case when v_new then (case when status in ('in_stock','reserved') then 'sold' else status end)
                  when status = 'in_stock' then 'reserved' else status end,
    ownership = case when v_new then (case when v_keep then 'vista' else 'transferred' end)::car_ownership_status else ownership end
  where id = v_vehicle and company_id = v_company;

  if v_new then
    update car_contracts set status = 'active',
      start_date = coalesce(start_date, (select min(due_date) from car_installments where contract_id = v_id), current_date)
    where id = v_id;
  end if;

  -- Post it. The autopost trigger only fires when status, sale_price, advance
  -- or purchase_cost change, so a discount-only edit would otherwise leave the
  -- ledger empty after the unpost above. car_post_entry is keyed on
  -- (source, reference), so calling it when the trigger already did is a no-op.
  perform car_post_contract(v_id);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when v_new then 'car_invoice_created' else 'car_invoice_updated' end,
          'car_contract', v_id, jsonb_build_object('sale_price', v_sale, 'discount', v_disc,
                                                   'net_payable', v_net, 'advance', v_adv,
                                                   'installments', i, 'keep_vista', v_keep));
  return v_id;
end $function$;

revoke all on function car_contract_save(uuid, jsonb, jsonb) from public, anon;
grant execute on function car_contract_save(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- delete ----

create or replace function car_contract_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_vehicle uuid; v_status car_contract_status;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select status, vehicle_id into v_status, v_vehicle from car_contracts where id = p_id and company_id = v_company;
  if not found then raise exception 'Contract not found'; end if;

  -- A raised invoice can be deleted, but only by somebody explicitly allowed to
  -- reach into posted accounts, and only after everything it did is undone.
  if v_status <> 'draft' then
    perform staff_require_doc_strict('car_invoice', 'edit_posted');
    perform car_contract_unpost(p_id, 'deleted');
  end if;

  delete from car_contracts where id = p_id and company_id = v_company;

  -- The vehicle goes back on the shelf, whichever state it was in.
  update car_vehicles set
    status = case when status in ('sold','reserved','delivered') then 'in_stock' else status end,
    current_customer_id = null, contract_id = null, ownership = 'vista'
  where id = v_vehicle and company_id = v_company and contract_id = p_id;
end $function$;

revoke all on function car_contract_delete(uuid) from public, anon;
grant execute on function car_contract_delete(uuid) to authenticated;

-- ------------------------------------------------------------ commission ----
-- A percentage commission is worked out on what the customer actually pays.

create or replace function car_commission_save(p_contract uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_company uuid := auth_company_id(); v_type text; v_val numeric; v_amount numeric; v_sale numeric;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select net_payable into v_sale from car_contracts where id = p_contract and company_id = v_company;
  if not found then raise exception 'Contract not found'; end if;
  v_type := coalesce(nullif(p->>'comm_type',''),'fixed');
  v_val := coalesce(nullif(p->>'comm_value','')::numeric, 0);
  v_amount := case when v_type = 'percentage' then round(coalesce(v_sale,0) * v_val / 100, 2) else v_val end;
  insert into car_commissions(company_id, contract_id, reference_name, comm_type, comm_value, amount, paid, paid_date, notes)
  values (v_company, p_contract, nullif(p->>'reference_name',''), v_type, v_val, v_amount,
          coalesce((p->>'paid')::boolean,false), nullif(p->>'paid_date','')::date, nullif(p->>'notes',''))
  on conflict (contract_id) do update set
    reference_name = excluded.reference_name, comm_type = excluded.comm_type, comm_value = excluded.comm_value,
    amount = excluded.amount, paid = excluded.paid, paid_date = excluded.paid_date, notes = excluded.notes;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), 'car_commission_saved', 'car_contract', p_contract, jsonb_build_object('amount', v_amount));
end $function$;

revoke all on function car_commission_save(uuid, jsonb) from public, anon;
grant execute on function car_commission_save(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------- dashboard ----
-- One word each, inside two long report bodies. Patching the live definition
-- rather than reprinting 300 lines to change 'sale_price' to 'net_payable' —
-- and raising if the line is not where it is expected, so this cannot silently
-- do nothing.

do $$
declare src text; out text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dashboard_metrics';
  out := replace(src, 'coalesce(sum(c.sale_price), 0) as sale_value',
                      'coalesce(sum(c.net_payable), 0) as sale_value');
  if out = src then
    raise exception 'dashboard_metrics: the car sale_value line has moved — patch it by hand.';
  end if;
  execute out;
end $$;

do $$
declare src text; out text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'dashboard_module_metrics';
  out := replace(src, '''value'',     coalesce(sum(sale_price), 0))',
                      '''value'',     coalesce(sum(net_payable), 0))');
  if out = src then
    raise exception 'dashboard_module_metrics: the car value line has moved — patch it by hand.';
  end if;
  execute out;
end $$;
