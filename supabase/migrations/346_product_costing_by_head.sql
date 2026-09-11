-- A car's cost is made of named parts, not one number called "expenses".
--
-- acct_products already carried a cost: purchase_rate, plus a single lumped
-- expense_rate, with total_cost generated as the sum of the two. That total is
-- load-bearing — the Sales Quotation fills Total Cost (COGS) from it, and the
-- margin, the selling price and the whole instalment calculation are worked out
-- from there. But "expenses: 4,200" says nothing about what the 4,200 was, so
-- nobody could check it, and a head that had been forgotten looked exactly like
-- a head that was genuinely zero.
--
-- The parts are now rows: one per expense head, against the item. The heads are
-- the SAME master the Car Expense voucher uses (acct_car_purchase_expenses), so
-- what a car is expected to cost and what it actually costs are described in one
-- vocabulary and can be compared. Add a head there and it appears on every
-- item's Costing tab; there is no second list to keep in step.
--
-- WHAT KEEPS total_cost RIGHT. A trigger recomputes acct_products.expense_rate
-- as the sum of the item's costing rows, so the generated total_cost follows
-- automatically and every reader of it — the quotation, the Purchase Order's
-- rate ceiling — keeps working untouched. That is the whole reason this is a
-- child table with a trigger rather than a new column the readers would have to
-- learn about: nothing downstream changes.
--
-- expense_rate is therefore no longer typed by hand once an item has costing
-- rows.
--
-- THE LUMP THAT ALREADY EXISTS IS CARRIED ACROSS, and this is not optional.
-- One item in the chart carries 20,000 of expense today. Left alone it would
-- keep it — until somebody opened the Costing tab, saw five heads at zero, and
-- pressed Save: the sum of the rows is zero, so the trigger would set
-- expense_rate to zero and the item's total_cost would silently drop by 20,000.
-- The next quotation would then price that car 20,000 under its cost, and
-- nothing on the screen would have said so.
--
-- So every existing lump becomes a real row against an OTHER head. The sum is
-- identical, total_cost does not move, and the tab shows the 20,000 as
-- something that exists and can be moved onto the heads it actually belongs to,
-- rather than as an absence.

begin;

create table if not exists public.acct_product_costing (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  product_id  uuid not null references public.acct_products(id) on delete cascade,
  expense_id  uuid not null references public.acct_car_purchase_expenses(id) on delete cascade,
  amount      numeric(18,2) not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  unique (product_id, expense_id)
);

create index if not exists acct_product_costing_product_idx on public.acct_product_costing (product_id);

alter table public.acct_product_costing enable row level security;

-- The child follows the parent. A user restricted to certain products must not
-- read the costing of one they cannot see, so the policy asks acct_products
-- rather than repeating its scope test — if the item is visible, its costing is.
drop policy if exists acct_product_costing_staff on public.acct_product_costing;
create policy acct_product_costing_staff on public.acct_product_costing
  for all
  using (exists (select 1 from public.acct_products p where p.id = product_id))
  with check (company_id = (select auth_company_id()) and (select is_staff())
              and exists (select 1 from public.acct_products p where p.id = product_id));

grant select on public.acct_product_costing to authenticated;

-- ── the lump follows the parts ─────────────────────────────────────────────
create or replace function public.acct_product_costing_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_product uuid;
begin
  v_product := coalesce(new.product_id, old.product_id);
  update acct_products
     set expense_rate = coalesce((select sum(amount) from acct_product_costing where product_id = v_product), 0)
   where id = v_product;
  return null;
end $f$;

drop trigger if exists trg_acct_product_costing_sync on public.acct_product_costing;
create trigger trg_acct_product_costing_sync
  after insert or update or delete on public.acct_product_costing
  for each row execute function acct_product_costing_sync();

-- ── the heads the business actually names ──────────────────────────────────
-- Seeded because they were named as the heads a car carries. Only inserted when
-- absent, and the amount is left at zero: what a head is WORTH is the user's to
-- say on the item, and a default typed here would be a number nobody chose.
insert into public.acct_car_purchase_expenses (company_id, name, amount, is_active)
select c.id, h.name, 0, true
  from public.companies c
 cross join (values ('CAMERA'), ('CUSTOM'), ('INSURANCE'), ('AGENT'), ('OTHER')) as h(name)
 where not exists (
   select 1 from public.acct_car_purchase_expenses e
    where e.company_id = c.id and upper(e.name) = h.name);

-- ── carry the existing lump across, so no total moves ──────────────────────
insert into public.acct_product_costing (company_id, product_id, expense_id, amount)
select p.company_id, p.id, e.id, p.expense_rate
  from public.acct_products p
  join public.acct_car_purchase_expenses e
    on e.company_id = p.company_id and upper(e.name) = 'OTHER'
 where not p.is_group and coalesce(p.expense_rate, 0) <> 0
on conflict (product_id, expense_id) do nothing;

-- ── one guarded door for the Costing tab ───────────────────────────────────
-- Purchase rate and every head amount are saved together. Separately, a save
-- that failed halfway would leave total_cost describing a cost that was never
-- agreed — and total_cost is what the next quotation prices a car from.
create or replace function public.product_costing_save(
  p_product uuid, p_purchase_rate numeric, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare v_co uuid; v_line jsonb; v_eid uuid; v_amt numeric; v_name text; v_total numeric;
begin
  if not is_staff() then raise exception 'Not signed in'; end if;
  perform staff_require_doc('product_tree', 'edit');
  v_co := auth_company_id();

  -- RLS is not reachable from a definer routine, so the item's visibility is
  -- asked for explicitly: a restricted user must not price an item they are not
  -- allowed to see.
  select name into v_name from acct_products
   where id = p_product and company_id = v_co
     and (staff_scope_ids('product') is null or id = any (staff_scope_ids('product')::uuid[]));
  if not found then raise exception 'That item is not one you can edit'; end if;

  if p_purchase_rate is not null then
    if p_purchase_rate < 0 then raise exception 'The purchase rate cannot be negative'; end if;
    update acct_products set purchase_rate = p_purchase_rate where id = p_product;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_eid := (v_line->>'expense_id')::uuid;
    v_amt := round(coalesce((v_line->>'amount')::numeric, 0), 2);
    if v_amt < 0 then raise exception 'A cost cannot be negative'; end if;
    if not exists (select 1 from acct_car_purchase_expenses where id = v_eid and company_id = v_co) then
      raise exception 'Unknown expense head';
    end if;
    -- Zero is not "no cost decided", it is a head that costs nothing, and
    -- storing it keeps the tab showing what was actually considered.
    insert into acct_product_costing (company_id, product_id, expense_id, amount, updated_by)
    values (v_co, p_product, v_eid, v_amt, auth.uid())
    on conflict (product_id, expense_id)
      do update set amount = excluded.amount, updated_at = now(), updated_by = excluded.updated_by;
  end loop;

  select total_cost into v_total from acct_products where id = p_product;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'product_costing_saved', 'acct_product', p_product,
          jsonb_build_object('item', v_name, 'purchase_rate', p_purchase_rate, 'total_cost', v_total));

  return jsonb_build_object('ok', true, 'total_cost', v_total);
end $f$;
revoke all on function public.product_costing_save(uuid, numeric, jsonb) from public, anon;
grant execute on function public.product_costing_save(uuid, numeric, jsonb) to authenticated;

do $chk$
declare n int;
begin
  select count(*) into n from acct_car_purchase_expenses
   where upper(name) in ('CAMERA','CUSTOM','INSURANCE','AGENT','REGISTRATION','OTHER');
  if n < 6 then raise exception '346: expected the 6 heads, found %', n; end if;
  -- the point of the backfill: not one item's cost may have moved
  select count(*) into n from acct_products p
   where not p.is_group
     and coalesce(p.expense_rate,0)
         <> coalesce((select sum(amount) from acct_product_costing c where c.product_id = p.id), 0)
     and exists (select 1 from acct_product_costing c where c.product_id = p.id);
  if n <> 0 then raise exception '346: % item(s) disagree with their costing rows', n; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_acct_product_costing_sync') then
    raise exception '346: the expense_rate sync trigger is missing';
  end if;
end $chk$;

commit;
