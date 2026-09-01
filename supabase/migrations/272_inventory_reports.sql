-- 272_inventory_reports.sql
-- Inventory module reporting layer (the module previously shipped as "Store").
--
-- Everything here reads the stock_movements ledger written by stock_move() —
-- there is no second source of truth. A movement carries a SIGNED qty (+ in,
-- - out) and an UNSIGNED value, so a running value balance is sign(qty)*value.
--
-- Adds: item picker tree, stock ledger, opening register, stock statement,
-- movement register (flat + multi-level), virtual stock, valuation, ABC,
-- ageing, reorder, fast/slow moving, peak/low balances, item query, and
-- purchase indents raised from low stock.

-- ---------------------------------------------------------------------------
-- Indents: an internal purchase requisition raised for items under reorder level.
-- ---------------------------------------------------------------------------
create table if not exists stock_indents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  doc_no text not null,
  doc_date date not null default current_date,
  warehouse_id uuid references warehouses(id),
  status text not null default 'open',   -- open / ordered / cancelled
  narration text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_indents on stock_indents(company_id, doc_date);
alter table stock_indents enable row level security;
drop policy if exists stock_indents_staff on stock_indents;
create policy stock_indents_staff on stock_indents for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

create table if not exists stock_indent_lines (
  id uuid primary key default gen_random_uuid(),
  indent_id uuid not null references stock_indents(id) on delete cascade,
  item_id uuid not null references acct_products(id),
  qty numeric(18,3) not null default 0,           -- suggested order quantity
  balance_qty numeric(18,3) not null default 0,   -- stock on hand when raised
  reorder_level numeric(18,3) not null default 0,
  sort int not null default 0
);
create index if not exists idx_stock_indent_lines on stock_indent_lines(indent_id);
alter table stock_indent_lines enable row level security;
drop policy if exists stock_indent_lines_staff on stock_indent_lines;
create policy stock_indent_lines_staff on stock_indent_lines for all to authenticated
  using (exists (select 1 from stock_indents i where i.id = indent_id and i.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from stock_indents i where i.id = indent_id and i.company_id = auth_company_id() and is_staff()));

-- Reorder quantity: how many to buy back up to. Kept on the product so the
-- reorder report and the indents agree on one number.
alter table acct_products add column if not exists reorder_qty numeric(18,3) not null default 0;

-- ---------------------------------------------------------------------------
-- Item picker tree — the left panel of every report dialog: product groups,
-- their stock items, and each item's current quantity balance.
-- ---------------------------------------------------------------------------
create or replace function stock_item_tree()
returns jsonb language sql stable security definer set search_path = public as $$
  with bal as (
    select b.item_id, sum(b.qty) qty from stock_balances b
    where b.company_id = auth_company_id() group by b.item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'parent_id', p.parent_id, 'name', p.name, 'is_group', p.is_group,
    'uom', p.uom, 'qty', coalesce(b.qty, 0),
    'reorder_level', p.reorder_level, 'reorder_qty', p.reorder_qty)
    order by p.is_group desc, p.sort, p.name), '[]'::jsonb)
  from acct_products p
  left join bal b on b.item_id = p.id
  where p.company_id = auth_company_id() and p.is_active
    and (p.is_group or p.is_stock);
$$;

-- ---------------------------------------------------------------------------
-- Stock Ledger — every receipt and issue for the chosen items, in date order,
-- with a running quantity and value balance. Opening balance leads each item.
-- ---------------------------------------------------------------------------
create or replace function stock_ledger_report(
  p_from date, p_to date, p_items uuid[] default null, p_wh uuid default null, p_moved_only boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with sel as (
    select p.id, p.name, p.uom
    from acct_products p
    where p.company_id = auth_company_id() and p.is_stock and not p.is_group
      and (p_items is null or p.id = any(p_items))
  ),
  mv as (
    select m.id, m.item_id, m.doc_date, m.doc_no, m.doc_type, m.qty, m.rate, m.value,
           m.reference, m.narration, m.created_at, sign(m.qty) * m.value as signed_value
    from stock_movements m
    where m.company_id = auth_company_id() and (p_wh is null or m.warehouse_id = p_wh)
  ),
  opening as (
    select s.id item_id,
           coalesce(sum(mv.qty), 0) qty,
           coalesce(sum(mv.signed_value), 0) value
    from sel s
    left join mv on mv.item_id = s.id and p_from is not null and mv.doc_date < p_from
    group by s.id
  ),
  period as (
    select s.id item_id, mv.id mid, mv.doc_date, mv.doc_no, mv.doc_type, mv.qty, mv.rate,
           mv.value, mv.signed_value, mv.created_at,
           coalesce(pa.name, td.narration, mv.narration, mv.reference) as counterparty
    from sel s
    join mv on mv.item_id = s.id
    left join trade_documents td on td.doc_no = mv.reference and td.company_id = auth_company_id()
    left join parties pa on pa.id = td.party_id
    where (p_from is null or mv.doc_date >= p_from) and (p_to is null or mv.doc_date <= p_to)
  ),
  ranked as (
    select p.*,
      o.qty + sum(p.qty) over w as bal_qty,
      o.value + sum(p.signed_value) over w as bal_value
    from period p
    join opening o on o.item_id = p.item_id
    window w as (partition by p.item_id order by p.doc_date, p.created_at, p.mid
                 rows between unbounded preceding and current row)
  ),
  per_item as (
    select s.id, s.name, s.uom, o.qty op_qty, o.value op_value,
      coalesce((select jsonb_agg(jsonb_build_object(
        'date', r.doc_date, 'voucher_no', r.doc_no, 'name', r.counterparty, 'doc_type', r.doc_type,
        'qty_rec', case when r.qty > 0 then r.qty else 0 end,
        'rate_rec', case when r.qty > 0 then r.rate else 0 end,
        'rec_value', case when r.qty > 0 then r.value else 0 end,
        'qty_iss', case when r.qty < 0 then -r.qty else 0 end,
        'rate_iss', case when r.qty < 0 then r.rate else 0 end,
        'iss_value', case when r.qty < 0 then r.value else 0 end,
        'bal_qty', r.bal_qty, 'bal_value', r.bal_value)
        order by r.doc_date, r.created_at, r.mid)
        from ranked r where r.item_id = s.id), '[]'::jsonb) entries
    from sel s join opening o on o.item_id = s.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', id, 'item', name, 'uom', uom,
    'opening_qty', op_qty, 'opening_value', op_value,
    'rows', entries) order by name), '[]'::jsonb)
  from per_item
  where not coalesce(p_moved_only, false) or jsonb_array_length(entries) > 0;
$$;

-- ---------------------------------------------------------------------------
-- Opening Stocks Register — quantity, value and rate held as at a date,
-- per item per warehouse (the balance BEFORE that date's movements).
-- ---------------------------------------------------------------------------
create or replace function stock_opening_register(
  p_as_of date, p_items uuid[] default null, p_wh uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with agg as (
    select m.item_id, m.warehouse_id, sum(m.qty) qty, sum(sign(m.qty) * m.value) value
    from stock_movements m
    where m.company_id = auth_company_id()
      and (p_as_of is null or m.doc_date < p_as_of)
      and (p_wh is null or m.warehouse_id = p_wh)
      and (p_items is null or m.item_id = any(p_items))
    group by m.item_id, m.warehouse_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', pr.name, 'uom', pr.uom, 'warehouse', w.name,
    'qty', a.qty, 'value', a.value,
    'rate', case when a.qty <> 0 then round(a.value / a.qty, 2) else 0 end)
    order by pr.name, w.name), '[]'::jsonb)
  from agg a
  join acct_products pr on pr.id = a.item_id
  join warehouses w on w.id = a.warehouse_id
  where a.qty <> 0 or a.value <> 0;
$$;

-- ---------------------------------------------------------------------------
-- Stock Statement — opening / receipts / issues / closing per item for a period.
-- The backbone of the multi-level report.
-- ---------------------------------------------------------------------------
create or replace function stock_statement(
  p_from date, p_to date, p_items uuid[] default null, p_wh uuid default null, p_moved_only boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with sel as (
    select p.id, p.name, p.uom, p.parent_id
    from acct_products p
    where p.company_id = auth_company_id() and p.is_stock and not p.is_group
      and (p_items is null or p.id = any(p_items))
  ),
  mv as (
    select m.item_id, m.doc_date, m.qty, m.value, sign(m.qty) * m.value signed_value,
           (p_from is not null and m.doc_date < p_from) as is_opening,
           ((p_from is null or m.doc_date >= p_from) and (p_to is null or m.doc_date <= p_to)) as in_period
    from stock_movements m
    where m.company_id = auth_company_id() and (p_wh is null or m.warehouse_id = p_wh)
  ),
  agg as (
    select s.id, s.name, s.uom, s.parent_id,
      coalesce(sum(mv.qty) filter (where mv.is_opening), 0) op_qty,
      coalesce(sum(mv.signed_value) filter (where mv.is_opening), 0) op_value,
      coalesce(sum(mv.qty) filter (where mv.in_period and mv.qty > 0), 0) in_qty,
      coalesce(sum(mv.value) filter (where mv.in_period and mv.qty > 0), 0) in_value,
      coalesce(sum(-mv.qty) filter (where mv.in_period and mv.qty < 0), 0) out_qty,
      coalesce(sum(mv.value) filter (where mv.in_period and mv.qty < 0), 0) out_value,
      count(*) filter (where mv.in_period) moves
    from sel s left join mv on mv.item_id = s.id
    group by s.id, s.name, s.uom, s.parent_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', id, 'item', name, 'uom', uom, 'group_id', parent_id,
    'opening_qty', op_qty, 'opening_value', op_value,
    'in_qty', in_qty, 'in_value', in_value,
    'out_qty', out_qty, 'out_value', out_value,
    'closing_qty', op_qty + in_qty - out_qty,
    'closing_value', op_value + in_value - out_value,
    'moves', moves) order by name), '[]'::jsonb)
  from agg
  where not coalesce(p_moved_only, false) or moves > 0;
$$;

-- ---------------------------------------------------------------------------
-- Stock Movement register — the flat voucher-by-voucher list for a period.
-- ---------------------------------------------------------------------------
create or replace function stock_movement_report(
  p_from date, p_to date, p_items uuid[] default null, p_wh uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', m.doc_date, 'doc_no', m.doc_no, 'doc_type', m.doc_type,
    'item', pr.name, 'uom', pr.uom, 'warehouse', w.name,
    'in_qty', case when m.qty > 0 then m.qty else 0 end,
    'out_qty', case when m.qty < 0 then -m.qty else 0 end,
    'rate', m.rate, 'value', m.value,
    'name', coalesce(pa.name, td.narration, m.narration, m.reference),
    'reference', m.reference, 'narration', m.narration,
    'gl_entry', m.gl_entry)
    order by m.doc_date, m.created_at), '[]'::jsonb)
  from stock_movements m
  join acct_products pr on pr.id = m.item_id
  join warehouses w on w.id = m.warehouse_id
  left join trade_documents td on td.doc_no = m.reference and td.company_id = m.company_id
  left join parties pa on pa.id = td.party_id
  where m.company_id = auth_company_id()
    and (p_from is null or m.doc_date >= p_from) and (p_to is null or m.doc_date <= p_to)
    and (p_wh is null or m.warehouse_id = p_wh)
    and (p_items is null or m.item_id = any(p_items));
$$;

-- ---------------------------------------------------------------------------
-- Multi-level Stock Movement — the stock statement rolled up the product-group
-- tree, so every group carries the totals of everything beneath it. The UI
-- nests the groups by parent_id.
-- ---------------------------------------------------------------------------
create or replace function stock_movement_multilevel(
  p_from date, p_to date, p_items uuid[] default null, p_wh uuid default null, p_moved_only boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with items as (
    select (x->>'item_id')::uuid item_id, (x->>'group_id')::uuid group_id, x
    from jsonb_array_elements(stock_statement(p_from, p_to, p_items, p_wh, p_moved_only)) x
  ),
  -- Every item counted against each of its ancestor groups.
  anc as (
    select i.item_id, i.x, g.id group_id, g.name group_name, g.parent_id
    from items i
    left join lateral (
      with recursive up(id, name, parent_id) as (
        select p.id, p.name, p.parent_id from acct_products p where p.id = i.group_id
        union all
        select p.id, p.name, p.parent_id from acct_products p join up on p.id = up.parent_id
      ) select * from up
    ) g on true
    where g.id is not null
  ),
  group_tot as (
    select group_id, group_name, parent_id,
      sum((x->>'opening_qty')::numeric) op_qty, sum((x->>'opening_value')::numeric) op_value,
      sum((x->>'in_qty')::numeric) in_qty, sum((x->>'in_value')::numeric) in_value,
      sum((x->>'out_qty')::numeric) out_qty, sum((x->>'out_value')::numeric) out_value
    from anc group by group_id, group_name, parent_id
  )
  select jsonb_build_object(
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', group_id, 'name', group_name, 'parent_id', parent_id,
        'opening_qty', op_qty, 'opening_value', op_value,
        'in_qty', in_qty, 'in_value', in_value, 'out_qty', out_qty, 'out_value', out_value,
        'closing_qty', op_qty + in_qty - out_qty, 'closing_value', op_value + in_value - out_value)
        order by group_name) from group_tot), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(x) from items), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Virtual Stock Analysis — what the warehouse will hold once the open paperwork
-- lands: on hand + on order (purchase orders not yet received) - committed
-- (sale orders / delivery notes not yet issued).
-- ---------------------------------------------------------------------------
create or replace function stock_virtual_analysis(p_wh uuid default null, p_items uuid[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with onhand as (
    select b.item_id, sum(b.qty) qty, sum(b.value) value
    from stock_balances b
    where b.company_id = auth_company_id() and (p_wh is null or b.warehouse_id = p_wh)
    group by b.item_id
  ),
  pipeline as (
    select l.product_id item_id,
      sum(case when d.doc_type in ('purchase_order','mrn') then l.quantity else 0 end) on_order,
      sum(case when d.doc_type in ('sale_order','delivery_note') then l.quantity else 0 end) committed
    from trade_documents d
    join trade_document_lines l on l.doc_id = d.id
    where d.company_id = auth_company_id() and l.product_id is not null
      and d.doc_type in ('purchase_order','mrn','sale_order','delivery_note')
      and coalesce(d.status, 'draft') not in ('cancelled', 'closed')
      and (p_wh is null or d.warehouse_id is null or d.warehouse_id = p_wh)
    group by l.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', pr.name, 'uom', pr.uom,
    'on_hand', coalesce(h.qty, 0), 'value', coalesce(h.value, 0),
    'on_order', coalesce(p.on_order, 0), 'committed', coalesce(p.committed, 0),
    'virtual', coalesce(h.qty, 0) + coalesce(p.on_order, 0) - coalesce(p.committed, 0),
    'reorder_level', pr.reorder_level,
    'short', (coalesce(h.qty,0) + coalesce(p.on_order,0) - coalesce(p.committed,0)) < pr.reorder_level)
    order by pr.name), '[]'::jsonb)
  from acct_products pr
  left join onhand h on h.item_id = pr.id
  left join pipeline p on p.item_id = pr.id
  where pr.company_id = auth_company_id() and pr.is_stock and not pr.is_group and pr.is_active
    and (p_items is null or pr.id = any(p_items))
    and (coalesce(h.qty,0) <> 0 or coalesce(p.on_order,0) <> 0 or coalesce(p.committed,0) <> 0);
$$;

-- ---------------------------------------------------------------------------
-- Stock Valuation — quantity, average rate and value held as at a date, with
-- each item's share of the total. p_as_of null = right now.
-- ---------------------------------------------------------------------------
create or replace function stock_valuation_report(
  p_as_of date default null, p_wh uuid default null, p_items uuid[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with agg as (
    select m.item_id, m.warehouse_id, sum(m.qty) qty, sum(sign(m.qty) * m.value) value
    from stock_movements m
    where m.company_id = auth_company_id()
      and (p_as_of is null or m.doc_date <= p_as_of)
      and (p_wh is null or m.warehouse_id = p_wh)
      and (p_items is null or m.item_id = any(p_items))
    group by m.item_id, m.warehouse_id
  ),
  tot as (select nullif(sum(value), 0) t from agg)
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', pr.name, 'uom', pr.uom, 'warehouse', w.name,
    'qty', a.qty, 'value', a.value,
    'avg_cost', case when a.qty <> 0 then round(a.value / a.qty, 2) else 0 end,
    'share', round(a.value / coalesce((select t from tot), 1) * 100, 2),
    'reorder_level', pr.reorder_level,
    'low', (pr.reorder_level > 0 and a.qty <= pr.reorder_level))
    order by pr.name, w.name), '[]'::jsonb)
  from agg a
  join acct_products pr on pr.id = a.item_id
  join warehouses w on w.id = a.warehouse_id
  where a.qty <> 0 or a.value <> 0;
$$;

-- ---------------------------------------------------------------------------
-- ABC Analysis — rank items by consumption value over a period, then split them
-- into A (top 80% of value), B (next 15%) and C (the rest).
-- ---------------------------------------------------------------------------
create or replace function stock_abc_analysis(p_from date, p_to date, p_wh uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with cons as (
    select m.item_id, sum(-m.qty) qty, sum(m.value) value
    from stock_movements m
    where m.company_id = auth_company_id() and m.qty < 0
      and (p_from is null or m.doc_date >= p_from) and (p_to is null or m.doc_date <= p_to)
      and (p_wh is null or m.warehouse_id = p_wh)
    group by m.item_id
    having sum(m.value) > 0
  ),
  tot as (select nullif(sum(value), 0) t from cons),
  ranked as (
    select c.item_id, c.qty, c.value, pr.name, pr.uom,
      sum(c.value) over (order by c.value desc, pr.name rows between unbounded preceding and current row)
        / coalesce((select t from tot), 1) * 100 as cum_pct,
      c.value / coalesce((select t from tot), 1) * 100 as pct,
      row_number() over (order by c.value desc, pr.name) rn
    from cons c join acct_products pr on pr.id = c.item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'rank', rn, 'item', name, 'uom', uom, 'qty', qty, 'value', value,
    'pct', round(pct, 2), 'cum_pct', round(cum_pct, 2),
    'class', case when cum_pct <= 80 then 'A' when cum_pct <= 95 then 'B' else 'C' end)
    order by rn), '[]'::jsonb)
  from ranked;
$$;

-- ---------------------------------------------------------------------------
-- Ageing Analysis — how old the stock on hand is. Receipts are consumed FIFO by
-- the issues that followed, and whatever is left is bucketed by receipt date.
-- ---------------------------------------------------------------------------
create or replace function stock_ageing_analysis(
  p_as_of date default null, p_wh uuid default null, p_items uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); v_as date := coalesce(p_as_of, current_date);
        r record; v_out jsonb := '[]'::jsonb;
        v_issue numeric; lot record; v_take numeric; v_left numeric;
        b0 numeric; b1 numeric; b2 numeric; b3 numeric; b4 numeric; v_val numeric; v_age int;
begin
  for r in
    select pr.id, pr.name, pr.uom
    from acct_products pr
    where pr.company_id = v_co and pr.is_stock and not pr.is_group and pr.is_active
      and (p_items is null or pr.id = any(p_items))
    order by pr.name
  loop
    -- Total issued up to the date, then walk the receipts oldest-first and knock
    -- it off; the remainder of each receipt is stock still on the shelf.
    select coalesce(sum(-m.qty), 0) into v_issue from stock_movements m
      where m.company_id = v_co and m.item_id = r.id and m.qty < 0 and m.doc_date <= v_as
        and (p_wh is null or m.warehouse_id = p_wh);

    b0 := 0; b1 := 0; b2 := 0; b3 := 0; b4 := 0; v_val := 0;
    for lot in
      select m.doc_date, m.qty, case when m.qty <> 0 then m.value / m.qty else 0 end rate
      from stock_movements m
      where m.company_id = v_co and m.item_id = r.id and m.qty > 0 and m.doc_date <= v_as
        and (p_wh is null or m.warehouse_id = p_wh)
      order by m.doc_date, m.created_at
    loop
      v_take := least(lot.qty, v_issue);
      v_issue := v_issue - v_take;
      v_left := lot.qty - v_take;
      if v_left <= 0 then continue; end if;
      v_age := v_as - lot.doc_date;
      if    v_age <= 30  then b0 := b0 + v_left;
      elsif v_age <= 60  then b1 := b1 + v_left;
      elsif v_age <= 90  then b2 := b2 + v_left;
      elsif v_age <= 180 then b3 := b3 + v_left;
      else                    b4 := b4 + v_left; end if;
      v_val := v_val + round(v_left * lot.rate, 2);
    end loop;

    if b0 + b1 + b2 + b3 + b4 > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'item', r.name, 'uom', r.uom,
        'qty', b0 + b1 + b2 + b3 + b4, 'value', v_val,
        'd0_30', b0, 'd31_60', b1, 'd61_90', b2, 'd91_180', b3, 'd180_plus', b4));
    end if;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Reorder Report — items at or below their reorder level, and how many to buy.
-- ---------------------------------------------------------------------------
create or replace function stock_reorder_report(p_wh uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with onhand as (
    select b.item_id, sum(b.qty) qty from stock_balances b
    where b.company_id = auth_company_id() and (p_wh is null or b.warehouse_id = p_wh)
    group by b.item_id
  ),
  onorder as (
    select l.product_id item_id, sum(l.quantity) qty
    from trade_documents d join trade_document_lines l on l.doc_id = d.id
    where d.company_id = auth_company_id() and d.doc_type = 'purchase_order'
      and coalesce(d.status, 'draft') not in ('cancelled', 'closed') and l.product_id is not null
    group by l.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', pr.id, 'item', pr.name, 'uom', pr.uom,
    'qty', coalesce(h.qty, 0), 'on_order', coalesce(o.qty, 0),
    'reorder_level', pr.reorder_level, 'reorder_qty', pr.reorder_qty,
    'shortfall', greatest(pr.reorder_level - coalesce(h.qty, 0), 0),
    'suggested', greatest(case when pr.reorder_qty > 0 then pr.reorder_qty
                               else pr.reorder_level - coalesce(h.qty, 0) end, 0))
    order by (pr.reorder_level - coalesce(h.qty, 0)) desc, pr.name), '[]'::jsonb)
  from acct_products pr
  left join onhand h on h.item_id = pr.id
  left join onorder o on o.item_id = pr.id
  where pr.company_id = auth_company_id() and pr.is_stock and not pr.is_group and pr.is_active
    and pr.reorder_level > 0 and coalesce(h.qty, 0) <= pr.reorder_level;
$$;

-- ---------------------------------------------------------------------------
-- Fast / Slow moving items — ranked by what left the warehouse in the period.
-- p_mode 'fast' = most movement first, 'slow' = least (items that never moved
-- rank first in the slow list).
-- ---------------------------------------------------------------------------
create or replace function stock_moving_items(
  p_from date, p_to date, p_mode text default 'fast', p_limit int default 50, p_wh uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with mv as (
    select m.item_id,
      sum(case when m.qty < 0 then -m.qty else 0 end) out_qty,
      sum(case when m.qty < 0 then m.value else 0 end) out_value,
      count(*) filter (where m.qty < 0) issues,
      max(case when m.qty < 0 then m.doc_date end) last_issue
    from stock_movements m
    where m.company_id = auth_company_id()
      and (p_from is null or m.doc_date >= p_from) and (p_to is null or m.doc_date <= p_to)
      and (p_wh is null or m.warehouse_id = p_wh)
    group by m.item_id
  ),
  bal as (
    select b.item_id, sum(b.qty) qty, sum(b.value) value from stock_balances b
    where b.company_id = auth_company_id() and (p_wh is null or b.warehouse_id = p_wh)
    group by b.item_id
  ),
  base as (
    select pr.id, pr.name, pr.uom,
      coalesce(m.out_qty, 0) out_qty, coalesce(m.out_value, 0) out_value,
      coalesce(m.issues, 0) issues, m.last_issue,
      coalesce(b.qty, 0) balance, coalesce(b.value, 0) balance_value
    from acct_products pr
    left join mv m on m.item_id = pr.id
    left join bal b on b.item_id = pr.id
    where pr.company_id = auth_company_id() and pr.is_stock and not pr.is_group and pr.is_active
  ),
  picked as (
    select * from base
    order by case when p_mode = 'slow' then out_qty else -out_qty end, name
    limit greatest(coalesce(p_limit, 50), 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', name, 'uom', uom, 'out_qty', out_qty, 'out_value', out_value,
    'issues', issues, 'last_issue', last_issue,
    'balance', balance, 'balance_value', balance_value,
    'days_idle', case when last_issue is null then null else least(coalesce(p_to, current_date), current_date) - last_issue end)
    order by case when p_mode = 'slow' then out_qty else -out_qty end, name), '[]'::jsonb)
  from picked;
$$;

-- ---------------------------------------------------------------------------
-- Peak / Low Balances — the highest and lowest quantity each item reached
-- during the period, and the day it happened.
-- ---------------------------------------------------------------------------
create or replace function stock_peak_low_balances(
  p_from date, p_to date, p_items uuid[] default null, p_wh uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with sel as (
    select p.id, p.name, p.uom from acct_products p
    where p.company_id = auth_company_id() and p.is_stock and not p.is_group and p.is_active
      and (p_items is null or p.id = any(p_items))
  ),
  mv as (
    select m.item_id, m.doc_date, m.created_at, m.id, m.qty
    from stock_movements m
    where m.company_id = auth_company_id() and (p_wh is null or m.warehouse_id = p_wh)
      and (p_to is null or m.doc_date <= p_to)
  ),
  opening as (
    select s.id item_id, coalesce(sum(mv.qty), 0) qty
    from sel s
    left join mv on mv.item_id = s.id and p_from is not null and mv.doc_date < p_from
    group by s.id
  ),
  running as (
    select mv.item_id, mv.doc_date, mv.created_at, mv.id,
      o.qty + sum(mv.qty) over (partition by mv.item_id order by mv.doc_date, mv.created_at, mv.id
                                rows between unbounded preceding and current row) bal
    from mv join opening o on o.item_id = mv.item_id
    where p_from is null or mv.doc_date >= p_from
  ),
  ext as (
    select item_id, max(bal) peak, min(bal) low,
      (array_agg(doc_date order by bal desc, doc_date))[1] peak_date,
      (array_agg(doc_date order by bal asc, doc_date))[1] low_date,
      -- same-day movements tie on doc_date, so close on the ledger's own order
      (array_agg(bal order by doc_date desc, created_at desc, id desc))[1] closing
    from running group by item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item', s.name, 'uom', s.uom,
    'opening', o.qty,
    'peak', coalesce(e.peak, o.qty), 'peak_date', e.peak_date,
    'low', coalesce(e.low, o.qty), 'low_date', e.low_date,
    'closing', coalesce(e.closing, o.qty))
    order by s.name), '[]'::jsonb)
  from sel s
  join opening o on o.item_id = s.id
  left join ext e on e.item_id = s.id
  where e.item_id is not null or o.qty <> 0;
$$;

-- ---------------------------------------------------------------------------
-- Query — everything known about one item on one screen: rates, reorder,
-- balances per warehouse, and the most recent movements.
-- ---------------------------------------------------------------------------
create or replace function stock_item_query(p_item uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'item', (select jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'uom', pr.uom,
        'purchase_rate', pr.purchase_rate, 'sell_rate', pr.sell_rate,
        'reorder_level', pr.reorder_level, 'reorder_qty', pr.reorder_qty,
        'group', (select g.name from acct_products g where g.id = pr.parent_id))
      from acct_products pr where pr.id = p_item and pr.company_id = auth_company_id()),
    'balances', coalesce((select jsonb_agg(jsonb_build_object(
        'warehouse', w.name, 'qty', b.qty, 'value', b.value,
        'avg_cost', case when b.qty <> 0 then round(b.value / b.qty, 2) else 0 end) order by w.name)
      from stock_balances b join warehouses w on w.id = b.warehouse_id
      where b.item_id = p_item and b.company_id = auth_company_id()), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(t.x) from (
        select jsonb_build_object(
          'date', m.doc_date, 'doc_no', m.doc_no, 'doc_type', m.doc_type,
          'warehouse', w.name, 'qty', m.qty, 'rate', m.rate, 'value', m.value,
          'name', coalesce(pa.name, m.narration, m.reference)) x
        from stock_movements m
        join warehouses w on w.id = m.warehouse_id
        left join trade_documents td on td.doc_no = m.reference and td.company_id = m.company_id
        left join parties pa on pa.id = td.party_id
        where m.item_id = p_item and m.company_id = auth_company_id()
        order by m.doc_date desc, m.created_at desc limit 25) t), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Raise Indents for Items with Low Stock — one indent document listing every
-- item under its reorder level, with the quantity to buy.
-- ---------------------------------------------------------------------------
create or replace function stock_raise_indent(
  p_wh uuid default null, p_items uuid[] default null, p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co uuid := auth_company_id(); v_no text; v_id uuid; r jsonb; i int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  r := stock_reorder_report(p_wh);
  if p_items is not null then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into r
      from jsonb_array_elements(r) x where (x->>'item_id')::uuid = any(p_items);
  end if;
  if jsonb_array_length(r) = 0 then raise exception 'Nothing is below its reorder level'; end if;

  insert into doc_sequences(company_id, doc_type, prefix, padding)
    values (v_co, 'stock_indent', 'IND-', 4) on conflict (company_id, doc_type) do nothing;
  v_no := next_doc_number(v_co, 'stock_indent');

  insert into stock_indents(company_id, doc_no, warehouse_id, narration, created_by)
    values (v_co, v_no, p_wh, p_narration, auth.uid()) returning id into v_id;

  insert into stock_indent_lines(indent_id, item_id, qty, balance_qty, reorder_level, sort)
  select v_id, (x.v->>'item_id')::uuid, (x.v->>'suggested')::numeric,
         (x.v->>'qty')::numeric, (x.v->>'reorder_level')::numeric, x.ord::int
  from jsonb_array_elements(r) with ordinality as x(v, ord);

  select count(*) into i from stock_indent_lines where indent_id = v_id;
  return jsonb_build_object('id', v_id, 'doc_no', v_no, 'lines', i);
end $$;

create or replace function stock_indent_list(p_from date default null, p_to date default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'doc_no', i.doc_no, 'date', i.doc_date, 'status', i.status,
    'warehouse', w.name, 'narration', i.narration,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'item', pr.name, 'uom', pr.uom, 'qty', l.qty,
        'balance_qty', l.balance_qty, 'reorder_level', l.reorder_level) order by l.sort)
      from stock_indent_lines l join acct_products pr on pr.id = l.item_id
      where l.indent_id = i.id), '[]'::jsonb))
    order by i.doc_date desc, i.doc_no desc), '[]'::jsonb)
  from stock_indents i
  left join warehouses w on w.id = i.warehouse_id
  where i.company_id = auth_company_id()
    and (p_from is null or i.doc_date >= p_from) and (p_to is null or i.doc_date <= p_to);
$$;

grant execute on function stock_item_tree() to authenticated;
grant execute on function stock_ledger_report(date, date, uuid[], uuid, boolean) to authenticated;
grant execute on function stock_opening_register(date, uuid[], uuid) to authenticated;
grant execute on function stock_statement(date, date, uuid[], uuid, boolean) to authenticated;
grant execute on function stock_movement_report(date, date, uuid[], uuid) to authenticated;
grant execute on function stock_movement_multilevel(date, date, uuid[], uuid, boolean) to authenticated;
grant execute on function stock_virtual_analysis(uuid, uuid[]) to authenticated;
grant execute on function stock_valuation_report(date, uuid, uuid[]) to authenticated;
grant execute on function stock_abc_analysis(date, date, uuid) to authenticated;
grant execute on function stock_ageing_analysis(date, uuid, uuid[]) to authenticated;
grant execute on function stock_reorder_report(uuid) to authenticated;
grant execute on function stock_moving_items(date, date, text, int, uuid) to authenticated;
grant execute on function stock_peak_low_balances(date, date, uuid[], uuid) to authenticated;
grant execute on function stock_item_query(uuid) to authenticated;
grant execute on function stock_raise_indent(uuid, uuid[], text) to authenticated;
grant execute on function stock_indent_list(date, date) to authenticated;
