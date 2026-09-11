-- A Car Invoice is not raised until the advance is actually in.
--
-- The advance on a Car Invoice posts nothing — it is what the invoice SAYS is
-- due up front, and the cash moves when a Car Receipt says it moved. So an
-- invoice could be raised naming a 40,000 advance that nobody had paid, and
-- nothing in the ERP would notice. The car then leaves on paperwork alone.
--
-- The rule asked for is: an ordinary user may only save the invoice once the
-- advance is fully paid; an admin, or somebody trusted with the override, may
-- save it anyway. That second half matters — a manager does sometimes let a car
-- go on a promise, and an ERP that made it impossible would be worked around
-- with a fake receipt, which is worse than an honest exception.
--
-- WHAT "PAID" MEANS HERE IS THE RECEIPTS, NOT A TICK.
--
-- A typed "received amount" would be a second place for the same fact to live,
-- and the one that could lie. Money questions read the ledger: the advance
-- received is the sum of the Car Receipt allocations marked 'advance'. The
-- screen therefore shows Paid / Partial Paid rather than asking for it, and the
-- Received and Balance figures are the real ones.
--
-- AND IT LOOKS IN TWO PLACES, WHICH IS THE WHOLE DIFFICULTY. The advance is
-- usually taken WEEKS BEFORE the invoice exists — the customer pays to hold the
-- car — so those receipts are anchored to the Sale Order, not to a contract
-- that has not been created yet. car_contract_link_source adopts them
-- afterwards, but "afterwards" is too late to gate the save. So the check asks
-- for receipts against the contract OR against the Sale Order the invoice is
-- being raised from, which is exactly where the money is at the moment the
-- question is asked.

begin;

-- ── how much of the advance is actually in ─────────────────────────────────
-- One routine, so the screen and the save gate cannot arrive at different
-- figures. Definer: the gate must see every receipt, not only those a
-- restricted caller could list.
create or replace function public.car_advance_received(
  p_contract uuid, p_source_doc uuid default null)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $f$
  select coalesce(sum(a.amount), 0)
    from car_receipts r
    join car_receipt_allocations a on a.receipt_id = r.id
   where a.target_type = 'advance'
     and r.company_id = auth_company_id()
     and ((p_contract   is not null and r.contract_id   = p_contract)
       or (p_source_doc is not null and r.source_doc_id = p_source_doc));
$f$;
revoke all on function public.car_advance_received(uuid, uuid) from public, anon;
grant execute on function public.car_advance_received(uuid, uuid) to authenticated;

-- ── may this user raise an invoice whose advance is short? ─────────────────
-- staff_perm_strict, not the ordinary read: everywhere else an empty setting
-- means unrestricted, and an override that a blank profile silently held would
-- be no rule at all. It has to be ticked by name.
create or replace function public.car_may_save_unpaid_advance()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $f$
  select has_role('admin') or staff_perm_strict('carsales.advance_override');
$f$;
revoke all on function public.car_may_save_unpaid_advance() from public, anon;
grant execute on function public.car_may_save_unpaid_advance() to authenticated;

-- ── the gate, inside the only door to a Car Invoice ────────────────────────
-- The whole routine is restated because the check has to sit where p_id may
-- still be null — a brand new invoice has no contract for the receipts to hang
-- off, so the Sale Order it is being raised from is the only place to look.
create or replace function public.car_contract_save(p_id uuid, p_header jsonb, p_installments jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
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
  v_src uuid := nullif(p_header->>'source_doc_id','')::uuid;
  v_recv numeric;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if v_vehicle is null then raise exception 'Select a vehicle'; end if;
  if nullif(p_header->>'customer_id','') is null then raise exception 'Select a customer'; end if;
  if v_disc < 0 then raise exception 'A discount cannot be negative.'; end if;
  if v_disc > v_sale then raise exception 'The discount (%) is more than the sale price (%).', round(v_disc,2), round(v_sale,2); end if;

  v_net := round(v_sale - v_disc, 2);

  v_sched := coalesce((select sum((e->>'amount')::numeric) from jsonb_array_elements(coalesce(p_installments,'[]'::jsonb)) e), 0);
  if round(v_adv + v_sched, 2) <> v_net then
    raise exception 'Advance (%) + installments (%) = % but must equal the net payable % (sale price % less discount %); difference %.',
      round(v_adv,2), round(v_sched,2), round(v_adv+v_sched,2), v_net, round(v_sale,2), round(v_disc,2), round(v_net-(v_adv+v_sched),2);
  end if;

  -- THE ADVANCE GATE. Asked before anything is written, and against the Sale
  -- Order as well as the contract, because on a new invoice the receipts are
  -- still anchored to the order.
  if v_adv > 0 then
    v_recv := car_advance_received(p_id, v_src);
    if round(v_recv, 2) < round(v_adv, 2) and not car_may_save_unpaid_advance() then
      raise exception 'The advance on this invoice is % and only % has been received. Enter the Car Receipt for the balance of %, or ask somebody authorised to save it.',
        round(v_adv, 2), round(v_recv, 2), round(v_adv - v_recv, 2);
    end if;
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
    if v_status <> 'draft' then
      perform staff_require_doc_strict('car_invoice', 'edit_posted');
      perform car_contract_unpost(v_id, 'edited');
    end if;
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

  -- The autopost trigger only fires when status, sale_price, advance or
  -- purchase_cost change, so a discount-only edit would otherwise leave the
  -- ledger empty after the unpost above. car_post_entry is keyed on
  -- (source, reference), so calling it when the trigger already did is a no-op.
  perform car_post_contract(v_id);

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_company, auth.uid(), case when v_new then 'car_invoice_created' else 'car_invoice_updated' end,
          'car_contract', v_id, jsonb_build_object('sale_price', v_sale, 'discount', v_disc,
                                                   'net_payable', v_net, 'advance', v_adv,
                                                   'advance_received', coalesce(v_recv, 0),
                                                   'installments', i, 'keep_vista', v_keep));
  return v_id;
end $function$;

do $chk$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='car_contract_save') not like '%car_may_save_unpaid_advance%'
  then raise exception '348: the advance gate is not in car_contract_save'; end if;
  -- one signature only: an overload here would mean PostgREST could reach the
  -- ungated version
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='car_contract_save') <> 1
  then raise exception '348: car_contract_save is overloaded'; end if;
end $chk$;

commit;
