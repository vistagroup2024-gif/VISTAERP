-- Product Costing: a cost sheet you fill in before you quote.
--
-- What did this item actually cost to put together, and what should it sell
-- for? That is a question asked BEFORE the sale, on a worksheet, and the
-- answer is what goes on the quotation. It is not a report of what happened —
-- P&L already answers that — and the report that used to sit here was
-- answering the wrong question.
--
-- A sheet names an item and a quantity, then lists what goes into it. Three
-- kinds of line, because costs arrive in three shapes:
--
--   rate     a price per unit          visa 300 x 40 pax   = 12,000
--   amount   a lump sum for the lot    permit fee          =    500
--   percent  a share of what is above  overhead 5%         =  2,600
--
-- A percent line is taken on the running total of every line ABOVE it, which is
-- how an overhead behaves: it is a share of the costs it sits on, not of the
-- whole sheet including itself. Order therefore matters, and the sheet keeps
-- it.
--
-- From the total it works out the cost per unit, and from the margin a
-- suggested selling price. Margin is a mark-up ON COST — 1,365 at 20% is
-- 1,638 — because that is the number a salesperson is working back from.
--
-- IT DOES NOT POST. A cost sheet is a plan, and nothing has happened yet; the
-- ledger hears about it when the purchase and the sale do. What it CAN do is
-- write its answer onto the item — but only when somebody presses the button,
-- because master data is the user's and nothing edits the Product Tree behind
-- their back.

create table if not exists costing_sheets (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  sheet_no     text not null,
  sheet_date   date not null default current_date,
  product_id   uuid references acct_products(id),
  item_name    text,
  quantity     numeric(18,3) not null default 1 check (quantity > 0),
  uom          text,
  margin_pct   numeric(9,4) not null default 0,
  -- Held rather than recomputed on every read: a sheet is a record of what was
  -- worked out on the day, and the rates behind it move.
  cost_total   numeric(18,2) not null default 0,
  cost_per_unit numeric(18,4) not null default 0,
  sell_price   numeric(18,4) not null default 0,
  narration    text,
  applied_at   timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, sheet_no)
);

create table if not exists costing_sheet_lines (
  id         uuid primary key default gen_random_uuid(),
  sheet_id   uuid not null references costing_sheets(id) on delete cascade,
  sort       integer not null default 0,
  component  text not null,
  kind       text not null default 'rate' check (kind in ('rate','amount','percent')),
  rate       numeric(18,4) not null default 0,
  quantity   numeric(18,3),
  percent    numeric(9,4) not null default 0,
  amount     numeric(18,2) not null default 0,
  notes      text
);
create index if not exists costing_sheet_lines_sheet_idx on costing_sheet_lines(sheet_id, sort);

alter table costing_sheets      enable row level security;
alter table costing_sheet_lines enable row level security;

drop policy if exists costing_sheets_staff on costing_sheets;
create policy costing_sheets_staff on costing_sheets for all
  using (company_id = auth_company_id() and is_staff())
  with check (company_id = auth_company_id() and is_staff());

drop policy if exists costing_sheet_lines_staff on costing_sheet_lines;
create policy costing_sheet_lines_staff on costing_sheet_lines for all
  using (exists (select 1 from costing_sheets s
                 where s.id = sheet_id and s.company_id = auth_company_id() and is_staff()))
  with check (exists (select 1 from costing_sheets s
                 where s.id = sheet_id and s.company_id = auth_company_id() and is_staff()));

-- ------------------------------------------------------------------ save ----

create or replace function costing_sheet_save(p_id uuid, p_header jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_co uuid := auth_company_id(); v_id uuid := p_id; v_no text;
  ln jsonb; i int := 0;
  v_qty numeric; v_running numeric(18,2) := 0; v_amt numeric(18,2);
  v_margin numeric; v_per_unit numeric(18,4);
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('product_costing', case when p_id is null then 'create' else 'edit' end);

  v_qty := coalesce(nullif(p_header->>'quantity','')::numeric, 1);
  if v_qty <= 0 then raise exception 'The quantity has to be more than nothing.'; end if;
  v_margin := coalesce(nullif(p_header->>'margin_pct','')::numeric, 0);

  if v_id is null then
    insert into doc_sequences(company_id, doc_type, prefix)
    values (v_co, 'costing_sheet', 'CS-')
    on conflict (company_id, doc_type) do nothing;
    v_no := next_doc_number(v_co, 'costing_sheet');
    insert into costing_sheets(company_id, sheet_no, sheet_date, product_id, item_name,
                               quantity, uom, margin_pct, narration, created_by)
    values (v_co, v_no,
            coalesce(nullif(p_header->>'sheet_date','')::date, current_date),
            nullif(p_header->>'product_id','')::uuid,
            nullif(btrim(coalesce(p_header->>'item_name','')),''),
            v_qty, nullif(p_header->>'uom',''), v_margin,
            nullif(p_header->>'narration',''), auth.uid())
    returning id, sheet_no into v_id, v_no;
  else
    update costing_sheets set
      sheet_date = coalesce(nullif(p_header->>'sheet_date','')::date, sheet_date),
      product_id = nullif(p_header->>'product_id','')::uuid,
      item_name  = nullif(btrim(coalesce(p_header->>'item_name','')),''),
      quantity   = v_qty,
      uom        = nullif(p_header->>'uom',''),
      margin_pct = v_margin,
      narration  = nullif(p_header->>'narration',''),
      updated_at = now()
    where id = v_id and company_id = v_co
    returning sheet_no into v_no;
    if v_no is null then raise exception 'Cost sheet not found'; end if;
    delete from costing_sheet_lines where sheet_id = v_id;
  end if;

  -- The lines, IN ORDER, because a percent line is a share of what sits above
  -- it. Rebuilding the running total here rather than trusting the amount the
  -- browser sent is the point: the sheet has to add up.
  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    i := i + 1;
    if nullif(btrim(coalesce(ln->>'component','')),'') is null then continue; end if;

    v_amt := case coalesce(ln->>'kind','rate')
      when 'amount'  then round(coalesce((ln->>'amount')::numeric, 0), 2)
      when 'percent' then round(v_running * coalesce((ln->>'percent')::numeric, 0) / 100, 2)
      else round(coalesce((ln->>'rate')::numeric, 0)
                 * coalesce(nullif(ln->>'quantity','')::numeric, v_qty), 2)
    end;
    v_running := v_running + v_amt;

    insert into costing_sheet_lines(sheet_id, sort, component, kind, rate, quantity, percent, amount, notes)
    values (v_id, i, btrim(ln->>'component'), coalesce(ln->>'kind','rate'),
            round(coalesce((ln->>'rate')::numeric, 0), 4),
            nullif(ln->>'quantity','')::numeric,
            round(coalesce((ln->>'percent')::numeric, 0), 4),
            v_amt, nullif(ln->>'notes',''));
  end loop;

  v_per_unit := round(v_running / v_qty, 4);
  update costing_sheets set
    cost_total    = v_running,
    cost_per_unit = v_per_unit,
    sell_price    = round(v_per_unit * (1 + v_margin / 100), 4),
    updated_at    = now()
  where id = v_id;

  return jsonb_build_object('id', v_id, 'sheet_no', v_no,
                            'cost_total', v_running, 'cost_per_unit', v_per_unit,
                            'sell_price', round(v_per_unit * (1 + v_margin / 100), 4));
end $function$;

-- ------------------------------------------------------------------ read ----

create or replace function costing_sheet_get(p_id uuid)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', s.id, 'sheet_no', s.sheet_no, 'sheet_date', s.sheet_date,
    'product_id', s.product_id, 'item_name', coalesce(s.item_name, p.name),
    'quantity', s.quantity, 'uom', coalesce(s.uom, p.uom), 'margin_pct', s.margin_pct,
    'cost_total', s.cost_total, 'cost_per_unit', s.cost_per_unit, 'sell_price', s.sell_price,
    'narration', s.narration, 'applied_at', s.applied_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'component', l.component, 'kind', l.kind, 'rate', l.rate,
        'quantity', l.quantity, 'percent', l.percent, 'amount', l.amount, 'notes', l.notes)
      order by l.sort) from costing_sheet_lines l where l.sheet_id = s.id), '[]'::jsonb))
  from costing_sheets s
  left join acct_products p on p.id = s.product_id
  where s.id = p_id and s.company_id = auth_company_id() and is_staff();
$function$;

create or replace function costing_sheets_list(p_limit int default 200)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x order by x->>'sheet_no' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', s.id, 'sheet_no', s.sheet_no, 'sheet_date', s.sheet_date,
      'item', coalesce(s.item_name, p.name, '—'),
      'quantity', s.quantity, 'uom', coalesce(s.uom, p.uom),
      'cost_total', s.cost_total, 'cost_per_unit', s.cost_per_unit,
      'margin_pct', s.margin_pct, 'sell_price', s.sell_price,
      'applied_at', s.applied_at) as x
    from costing_sheets s
    left join acct_products p on p.id = s.product_id
    where s.company_id = auth_company_id() and is_staff()
    order by s.sheet_no desc
    limit greatest(1, coalesce(p_limit, 200))
  ) t;
$function$;

create or replace function costing_sheet_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); v_no text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('product_costing', 'delete');
  delete from costing_sheets where id = p_id and company_id = v_co returning sheet_no into v_no;
  if v_no is null then raise exception 'Cost sheet not found'; end if;
  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'costing_sheet_deleted', 'costing_sheet', p_id,
          jsonb_build_object('sheet_no', v_no));
end $function$;

-- ----------------------------------------------------------------- apply ----
-- Writing the answer onto the item. Deliberately a separate routine behind a
-- separate button: master data is the user's, and a sheet is a working-out
-- until somebody decides it is the price.

create or replace function costing_sheet_apply(p_id uuid, p_cost boolean default true, p_sell boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_co uuid := auth_company_id(); s costing_sheets; v_name text;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform staff_require_doc('product_tree', 'edit');

  select * into s from costing_sheets where id = p_id and company_id = v_co;
  if not found then raise exception 'Cost sheet not found'; end if;
  if s.product_id is null then
    raise exception 'This sheet is not against an item from the Product Tree, so there is nothing to write it to.';
  end if;
  if not (p_cost or p_sell) then raise exception 'Nothing to apply.'; end if;

  select name into v_name from acct_products where id = s.product_id and company_id = v_co;
  if v_name is null then raise exception 'That item is no longer in the Product Tree.'; end if;

  update acct_products set
    purchase_rate = case when p_cost then round(s.cost_per_unit, 2) else purchase_rate end,
    sell_rate     = case when p_sell then round(s.sell_price, 2)    else sell_rate end
  where id = s.product_id and company_id = v_co;

  update costing_sheets set applied_at = now(), updated_at = now() where id = p_id;

  insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
  values (v_co, auth.uid(), 'costing_sheet_applied', 'costing_sheet', p_id,
          jsonb_build_object('sheet_no', s.sheet_no, 'item', v_name,
                             'purchase_rate', case when p_cost then round(s.cost_per_unit,2) end,
                             'sell_rate',     case when p_sell then round(s.sell_price,2) end));

  return jsonb_build_object('applied', true, 'item', v_name,
                            'purchase_rate', case when p_cost then round(s.cost_per_unit,2) end,
                            'sell_rate',     case when p_sell then round(s.sell_price,2) end);
end $function$;

revoke all on function costing_sheet_save(uuid, jsonb, jsonb)      from public, anon;
revoke all on function costing_sheet_get(uuid)                     from public, anon;
revoke all on function costing_sheets_list(int)                    from public, anon;
revoke all on function costing_sheet_delete(uuid)                  from public, anon;
revoke all on function costing_sheet_apply(uuid, boolean, boolean) from public, anon;
grant execute on function costing_sheet_save(uuid, jsonb, jsonb)      to authenticated;
grant execute on function costing_sheet_get(uuid)                     to authenticated;
grant execute on function costing_sheets_list(int)                    to authenticated;
grant execute on function costing_sheet_delete(uuid)                  to authenticated;
grant execute on function costing_sheet_apply(uuid, boolean, boolean) to authenticated;

-- It is a voucher, so it takes its place on the Work Flow board like the rest.
insert into workflow_steps (company_id, doc_type, label, module, source_type, enabled, sort)
select c.id, 'product_costing', 'Product Costing', 'Costing', null, true, 610
from companies c
on conflict (company_id, doc_type) do nothing;
