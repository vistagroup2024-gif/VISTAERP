-- Car expenses become their own voucher, against the vehicle.
--
-- They used to be nine columns on the Purchase Voucher line — insurance,
-- registration, camera, transport, customs, car inspection, agent, others,
-- commission. Two things were wrong with that. They had to be known when the
-- car was bought, and most of them are not: registration and insurance land
-- weeks later. And they did not actually reach the vehicle's cost —
-- car_vehicle_from_trade_doc splits the voucher TOTAL across the cars, and the
-- total is the supplier's billed amount, so anything typed in those nine
-- columns showed up in the "landed cost" line under the grid and nowhere else.
--
-- So: a voucher of its own, raised whenever the expense arrives, against the
-- vehicle it belongs to. It capitalises — Dr Vehicle Inventory, Cr whatever
-- paid it — and it adds to that vehicle's cost, which is what Total Cost (COGS)
-- on the quotation is meant to be quoting.

create table if not exists car_vehicle_expenses (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id),
  vehicle_id   uuid not null references car_vehicles(id) on delete cascade,
  -- The head from Masters -> Car Purchase Expense. Free-standing text is kept
  -- alongside it so a head that is later renamed or removed does not rewrite
  -- history on vouchers already posted.
  expense_id   uuid references acct_car_purchase_expenses(id),
  expense_name text not null,
  expense_date date not null default current_date,
  amount       numeric(18,2) not null check (amount > 0),
  narration    text,
  reference    text,
  entry_id     uuid references journal_entries(id),
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists car_vehicle_expenses_vehicle_idx on car_vehicle_expenses(vehicle_id);

alter table car_vehicle_expenses enable row level security;
drop policy if exists car_vehicle_expenses_staff on car_vehicle_expenses;
create policy car_vehicle_expenses_staff on car_vehicle_expenses for all
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

-- ── The vehicle's cost has to include them ─────────────────────────────────
-- total_cost is generated, so it cannot simply be updated; it is redefined to
-- take a third term, kept by the trigger below. car_vehicles is empty, so
-- there is nothing to backfill and nothing to lose in dropping the old column.
alter table car_vehicles add column if not exists expense_cost numeric(18,2) not null default 0;
alter table car_vehicles drop column if exists total_cost;
alter table car_vehicles add column total_cost numeric(18,2)
  generated always as (coalesce(purchase_cost,0) + coalesce(purchase_vat,0) + coalesce(expense_cost,0)) stored;

create or replace function public.car_vehicle_expense_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_vehicle uuid := coalesce(new.vehicle_id, old.vehicle_id);
begin
  update car_vehicles v
     set expense_cost = coalesce((select sum(e.amount) from car_vehicle_expenses e
                                   where e.vehicle_id = v_vehicle), 0)
   where v.id = v_vehicle;
  return coalesce(new, old);
end $function$;

drop trigger if exists trg_car_vehicle_expense_sync on car_vehicle_expenses;
create trigger trg_car_vehicle_expense_sync
after insert or update or delete on car_vehicle_expenses
for each row execute function car_vehicle_expense_sync();

-- next_doc_number invents a prefix from the first three letters, which for
-- car_expense is CAR- — the same shape as a vehicle number. Seed it as CEX-.
insert into doc_sequences(company_id, doc_type, prefix)
select id, 'car_expense', 'CEX-' from companies
on conflict (company_id, doc_type) do nothing;

-- ── Taking back its own posting ────────────────────────────────────────────
-- gl_voucher_void is the door for a voucher a person typed; acct_voucher_guard
-- turns away anything a module generated, which is exactly what these are. So
-- this module removes its own entry the way the visa module does
-- (visa_invoice_unpost) — and only ever its own: the entry has to be the one
-- this expense stored AND carry the car_expense source, or nothing is touched.
create or replace function public.car_expense_unpost(p_entry uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_entry is null then return; end if;
  if not exists (select 1 from journal_entries
                  where id = p_entry and source = 'car_expense'
                    and company_id = auth_company_id()) then
    raise exception 'That ledger entry was not raised by a car expense';
  end if;
  if exists (select 1 from allocations a join open_items o on o.id = a.open_item_id
              where o.entry_id = p_entry) then
    raise exception 'This expense has payments allocated against it — clear them first';
  end if;
  delete from open_items   where entry_id = p_entry;
  delete from journal_lines where entry_id = p_entry;
  delete from journal_entries where id = p_entry;
end $function$;

-- ── Saving one ─────────────────────────────────────────────────────────────
-- p_credit_account is what paid it: the supplier's payable, the bank, petty
-- cash. Left empty it falls to Vehicle Supplier Payable, which is where a car
-- expense most often sits until it is settled.
create or replace function public.car_expense_save(p_id uuid, p_header jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid; v_veh uuid; v_amt numeric; v_date date;
  v_head uuid; v_name text; v_credit uuid; v_inv uuid; v_posted jsonb;
  v_entry uuid; v_no text; v_old uuid;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform car_ensure_accounts(v_co);

  v_veh  := nullif(p_header->>'vehicle_id','')::uuid;
  v_amt  := coalesce(nullif(p_header->>'amount','')::numeric, 0);
  v_date := coalesce(nullif(p_header->>'expense_date','')::date, current_date);
  v_head := nullif(p_header->>'expense_id','')::uuid;
  v_name := nullif(btrim(coalesce(p_header->>'expense_name','')),'');
  v_credit := nullif(p_header->>'credit_account','')::uuid;

  if v_veh is null then raise exception 'Choose the vehicle'; end if;
  if v_amt <= 0 then raise exception 'Enter an amount'; end if;
  if v_name is null and v_head is not null then
    select name into v_name from acct_car_purchase_expenses where id = v_head;
  end if;
  if v_name is null then raise exception 'Choose the expense head'; end if;
  if not exists (select 1 from car_vehicles where id = v_veh and company_id = v_co) then
    raise exception 'Vehicle not found';
  end if;

  select id into v_inv from accounts where company_id = v_co and code = '1160';
  if v_credit is null then select id into v_credit from accounts where company_id = v_co and code = '2100'; end if;
  if v_inv is null or v_credit is null then raise exception 'Vehicle accounts are missing — seed the chart first'; end if;

  -- An edit takes back its own posting first, so the ledger never holds two
  -- for the same expense.
  if p_id is not null then
    select entry_id into v_old from car_vehicle_expenses where id = p_id and company_id = v_co;
    if v_old is not null then
      -- Let go of the entry before removing it: entry_id is a foreign key, and
      -- an expense still pointing at its posting is what stops the posting from
      -- being deleted at all.
      update car_vehicle_expenses set entry_id = null where id = p_id;
      perform car_expense_unpost(v_old);
    end if;
  end if;

  v_posted := gl_post(v_co, v_date,
    'Car expense — ' || v_name, 'car_expense', 'car_expense', nullif(p_header->>'reference',''),
    jsonb_build_array(
      jsonb_build_object('account_id', v_inv::text,    'debit', v_amt, 'credit', 0),
      jsonb_build_object('account_id', v_credit::text, 'debit', 0,     'credit', v_amt)));
  v_entry := (v_posted->>'entry_id')::uuid;
  v_no    := v_posted->>'entry_no';

  if p_id is null then
    insert into car_vehicle_expenses(company_id, vehicle_id, expense_id, expense_name,
                                     expense_date, amount, narration, reference, entry_id, created_by)
    values (v_co, v_veh, v_head, v_name, v_date, v_amt,
            nullif(p_header->>'narration',''), v_no, v_entry, auth.uid())
    returning id into v_id;
  else
    update car_vehicle_expenses set
      vehicle_id = v_veh, expense_id = v_head, expense_name = v_name, expense_date = v_date,
      amount = v_amt, narration = nullif(p_header->>'narration',''), reference = v_no, entry_id = v_entry
    where id = p_id and company_id = v_co
    returning id into v_id;
    if v_id is null then raise exception 'Car expense not found'; end if;
  end if;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), case when p_id is null then 'car_expense_created' else 'car_expense_updated' end,
          'car_vehicle_expense', v_id, jsonb_build_object('vehicle', v_veh, 'head', v_name, 'amount', v_amt));
  return v_id;
end $function$;

create or replace function public.car_expense_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); e car_vehicle_expenses%rowtype;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into e from car_vehicle_expenses where id = p_id and company_id = v_co;
  if not found then raise exception 'Car expense not found'; end if;
  -- The row goes first, for the same reason: while it exists it holds a
  -- foreign key on the entry its posting lives in.
  delete from car_vehicle_expenses where id = p_id;
  if e.entry_id is not null then perform car_expense_unpost(e.entry_id); end if;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'car_expense_deleted', 'car_vehicle_expense', p_id,
          jsonb_build_object('vehicle', e.vehicle_id, 'head', e.expense_name, 'amount', e.amount));
end $function$;

-- car_expense_unpost is internal: no grant at all, so only the two routines
-- above can reach it.
revoke all on function public.car_expense_unpost(uuid) from public, anon, authenticated;
revoke all on function public.car_expense_save(uuid, jsonb) from public, anon;
revoke all on function public.car_expense_delete(uuid) from public, anon;
grant execute on function public.car_expense_save(uuid, jsonb) to authenticated;
grant execute on function public.car_expense_delete(uuid) to authenticated;
