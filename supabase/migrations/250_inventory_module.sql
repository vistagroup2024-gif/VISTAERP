-- 250_inventory_module.sql
-- #20 General Inventory (goods) module — distinct from the hotel-bed BRN system.
-- Reuses the Product Tree as the item master (a product flagged is_stock is a
-- stock item). Tracks quantity + value per item per warehouse with moving-average
-- valuation, via a stock-movement ledger, and posts the GL:
--   Receipt: Dr Inventory / Cr <counter account>
--   Issue:   Dr Cost of Goods Sold / Cr Inventory (at average cost)

alter table acct_products add column if not exists is_stock boolean not null default false;
alter table acct_products add column if not exists uom text;
alter table acct_products add column if not exists reorder_level numeric(18,3) not null default 0;

create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table warehouses enable row level security;
drop policy if exists warehouses_staff on warehouses;
create policy warehouses_staff on warehouses for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

create table if not exists stock_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  item_id uuid not null references acct_products(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  qty numeric(18,3) not null default 0,
  value numeric(18,2) not null default 0,
  unique (company_id, item_id, warehouse_id)
);
alter table stock_balances enable row level security;
drop policy if exists stock_balances_staff on stock_balances;
create policy stock_balances_staff on stock_balances for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  doc_type text not null,          -- receipt / issue / adjust
  doc_no text not null,
  doc_date date not null default current_date,
  item_id uuid not null references acct_products(id),
  warehouse_id uuid not null references warehouses(id),
  qty numeric(18,3) not null,      -- signed: + in, - out
  rate numeric(18,2) not null default 0,
  value numeric(18,2) not null default 0,
  reference text,
  narration text,
  gl_entry uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_moves on stock_movements(company_id, item_id, doc_date);
alter table stock_movements enable row level security;
drop policy if exists stock_movements_staff on stock_movements;
create policy stock_movements_staff on stock_movements for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- Post a stock movement: update the moving-average balance and (optionally) the GL.
create or replace function stock_move(
  p_type text, p_item uuid, p_wh uuid, p_qty numeric, p_rate numeric, p_date date,
  p_reference text, p_narration text, p_post_gl boolean, p_counter uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); bal stock_balances%rowtype; v_no text; v_value numeric(18,2);
        v_signed numeric(18,3); v_avg numeric(18,4); v_inv uuid; v_cogs uuid; g jsonb; v_entry uuid; lines jsonb;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'Quantity must be positive'; end if;

  select * into bal from stock_balances where company_id = v_co and item_id = p_item and warehouse_id = p_wh for update;
  if not found then
    insert into stock_balances(company_id, item_id, warehouse_id, qty, value) values (v_co, p_item, p_wh, 0, 0)
      returning * into bal;
  end if;

  if p_type = 'issue' then
    if p_qty > bal.qty then raise exception 'Insufficient stock: have %, need %', bal.qty, p_qty; end if;
    v_avg := case when bal.qty > 0 then bal.value / bal.qty else 0 end;
    v_value := round(p_qty * v_avg, 2);
    v_signed := -p_qty;
    update stock_balances set qty = qty - p_qty, value = value - v_value where id = bal.id;
    p_rate := round(v_avg, 2);
  else -- receipt or adjust (positive add)
    v_value := round(p_qty * coalesce(p_rate,0), 2);
    v_signed := p_qty;
    update stock_balances set qty = qty + p_qty, value = value + v_value where id = bal.id;
  end if;

  insert into doc_sequences(company_id, doc_type, prefix)
    values (v_co, 'stock_'||p_type, upper(left(p_type,3))||'-') on conflict (company_id, doc_type) do nothing;
  v_no := next_doc_number(v_co, 'stock_'||p_type);

  insert into stock_movements(company_id, doc_type, doc_no, doc_date, item_id, warehouse_id, qty, rate, value, reference, narration, created_by)
    values (v_co, p_type, v_no, coalesce(p_date, current_date), p_item, p_wh, v_signed, coalesce(p_rate,0), v_value, p_reference, p_narration, auth.uid())
    returning id into v_entry;

  if coalesce(p_post_gl, false) and v_value > 0 then
    v_inv := acct_ensure_named(v_co, 'Inventory', 'asset', '1', 'Current Asset');
    if p_type = 'issue' then
      v_cogs := acct_ensure_named(v_co, 'Cost of Goods Sold', 'expense', '5', 'COGS');
      lines := jsonb_build_array(
        jsonb_build_object('account_id', v_cogs::text, 'debit', v_value, 'credit', 0, 'description', 'Stock issue '||v_no),
        jsonb_build_object('account_id', v_inv::text, 'debit', 0, 'credit', v_value, 'description', 'Stock issue '||v_no));
      g := gl_post(v_co, coalesce(p_date, current_date), 'Stock issue '||v_no, 'gl_stock_out', v_no, lines);
    elsif p_counter is not null then
      lines := jsonb_build_array(
        jsonb_build_object('account_id', v_inv::text, 'debit', v_value, 'credit', 0, 'description', 'Stock receipt '||v_no),
        jsonb_build_object('account_id', p_counter::text, 'debit', 0, 'credit', v_value, 'description', 'Stock receipt '||v_no));
      g := gl_post(v_co, coalesce(p_date, current_date), 'Stock receipt '||v_no, 'gl_stock_in', v_no, lines);
    end if;
    if g is not null then update stock_movements set gl_entry = (g->>'entry_id')::uuid where id = v_entry; end if;
  end if;

  return jsonb_build_object('id', v_entry, 'doc_no', v_no, 'value', v_value, 'rate', p_rate);
end $$;

-- Current stock balances (qty + value + avg cost).
create or replace function stock_balance_report()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', pr.name, 'uom', pr.uom, 'warehouse', w.name, 'qty', b.qty, 'value', b.value,
    'avg_cost', case when b.qty <> 0 then round(b.value / b.qty, 2) else 0 end,
    'reorder_level', pr.reorder_level, 'low', (pr.reorder_level > 0 and b.qty <= pr.reorder_level))
    order by pr.name, w.name), '[]'::jsonb)
  from stock_balances b
  join acct_products pr on pr.id = b.item_id
  join warehouses w on w.id = b.warehouse_id
  where b.company_id = auth_company_id() and (b.qty <> 0 or b.value <> 0);
$$;

grant execute on function stock_move(text, uuid, uuid, numeric, numeric, date, text, text, boolean, uuid) to authenticated;
grant execute on function stock_balance_report() to authenticated;
