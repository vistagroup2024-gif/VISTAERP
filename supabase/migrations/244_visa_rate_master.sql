-- 244_visa_rate_master.sql
-- Visa pricing upgrade: customer-wise sell rates and supplier-wise purchase
-- rates (default + overrides), automatic product selection by visa type + nights,
-- the NON-MASAR >20-night surcharge, and a group-company → supplier-account map.
-- The default rates stay on acct_products.sell_rate / purchase_rate; overrides
-- live here.

-- Per-agent sell override (customer-wise). Default = acct_products.sell_rate.
create table if not exists product_customer_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  product_id uuid not null references acct_products(id) on delete cascade,
  party_id uuid not null references parties(id) on delete cascade,
  sell_rate numeric(18,2) not null default 0,
  unique (company_id, product_id, party_id)
);
-- Per-supplier purchase override (supplier = a Chart-of-Accounts payable account).
-- Default = acct_products.purchase_rate.
create table if not exists product_supplier_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  product_id uuid not null references acct_products(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  purchase_rate numeric(18,2) not null default 0,
  unique (company_id, product_id, account_id)
);
alter table product_customer_rates enable row level security;
alter table product_supplier_rates enable row level security;
drop policy if exists pcr_staff on product_customer_rates;
create policy pcr_staff on product_customer_rates for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());
drop policy if exists psr_staff on product_supplier_rates;
create policy psr_staff on product_supplier_rates for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- Group company → supplier account (Chart of Accounts). Pre-seed the 3 known.
alter table group_companies add column if not exists supplier_account_id uuid references accounts(id);
update group_companies gc set supplier_account_id = a.id
  from accounts a where a.company_id = gc.company_id and upper(a.name) = 'BASMA GROUP'
   and lower(gc.name) in ('basma','wadiyar') and gc.supplier_account_id is null;
update group_companies gc set supplier_account_id = a.id
  from accounts a where a.company_id = gc.company_id and upper(a.name) = 'FAHAD TALQ'
   and lower(gc.name) = 'fahad talq' and gc.supplier_account_id is null;

-- Pick the visa product for a group from its type + nights.
create or replace function visa_pick_product(p_company uuid, p_visa_type text, p_nights int)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_name text; v_id uuid;
begin
  v_name := case lower(coalesce(p_visa_type,''))
    when 'masar' then 'UMRAH VISA (MASAR)'
    when 'long_stay' then 'UMRAH VISA (LONG STAY)'
    else case
      when coalesce(p_nights,0) <= 10 then 'UMRAH VISA (10 DAYS)'
      when coalesce(p_nights,0) <= 15 then 'UMRAH VISA (15 DAYS)'
      else 'UMRAH VISA (NON MASAR)' end
    end;
  select id into v_id from acct_products where company_id = p_company and is_group = false and is_active
    and upper(name) = upper(v_name) limit 1;
  return v_id;
end $$;

-- Sell rate per pax: per-agent override else product default; + SAR 3 × (nights−20)
-- surcharge on NON MASAR only.
create or replace function visa_sell_rate(p_company uuid, p_product uuid, p_agent uuid, p_nights int)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric(18,2); v_name text;
begin
  select coalesce(
    (select sell_rate from product_customer_rates where company_id = p_company and product_id = p_product and party_id = p_agent),
    (select sell_rate from acct_products where id = p_product), 0) into v;
  select name into v_name from acct_products where id = p_product;
  if upper(coalesce(v_name,'')) = 'UMRAH VISA (NON MASAR)' and coalesce(p_nights,0) > 20 then
    v := v + 3 * (p_nights - 20);
  end if;
  return round(coalesce(v,0), 2);
end $$;

-- Purchase rate per pax: per-supplier override else product default.
create or replace function visa_purchase_rate(p_company uuid, p_product uuid, p_supplier_acct uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(coalesce(
    (select purchase_rate from product_supplier_rates where company_id = p_company and product_id = p_product and account_id = p_supplier_acct),
    (select purchase_rate from acct_products where id = p_product), 0), 2);
$$;

grant execute on function visa_pick_product(uuid, text, int) to authenticated;
grant execute on function visa_sell_rate(uuid, uuid, uuid, int) to authenticated;
grant execute on function visa_purchase_rate(uuid, uuid, uuid) to authenticated;

-- Rewrite the posting to use product selection + customer/supplier rates + surcharge.
-- Customer side reuses party_invoice (receivable). Supplier side posts directly to
-- the mapped Chart-of-Accounts supplier account (Dr Visa Cost / Cr supplier).
create or replace function visa_group_post_gl(p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g umrah_groups; v_co uuid; v_nights int; v_prod uuid; v_sup uuid;
        v_sell numeric(18,2); v_cost numeric(18,2); v_inc uuid; v_exp uuid; r jsonb; lines jsonb; v_cc text := 'UMRAH VISA';
begin
  select * into g from umrah_groups where id = p_group;
  if not found then return jsonb_build_object('posted', false, 'reason', 'group not found'); end if;
  if g.gl_invoiced_at is not null then return jsonb_build_object('posted', false, 'reason', 'already posted'); end if;
  v_co := g.company_id;
  if coalesce(g.pax,0) <= 0 then return jsonb_build_object('posted', false, 'reason', 'no pax'); end if;

  v_nights := coalesce(g.total_nights,
    case when g.covered_from is not null and g.covered_to is not null then (g.covered_to - g.covered_from) else 0 end);
  v_prod := visa_pick_product(v_co, g.visa_type, v_nights);
  if v_prod is null then return jsonb_build_object('posted', false, 'reason', 'no product for visa type/nights'); end if;

  v_sup  := (select supplier_account_id from group_companies where id = g.group_company_id);
  v_sell := round(visa_sell_rate(v_co, v_prod, g.agent_id, v_nights) * g.pax, 2);
  v_cost := round(visa_purchase_rate(v_co, v_prod, v_sup) * g.pax, 2);

  -- Customer (agent) sales invoice: Dr agent / Cr Visa Sales.  Haji Name = group name.
  if g.agent_id is not null and v_sell > 0 then
    v_inc := acct_ensure_named(v_co, 'Visa Sales', 'income', '4', 'Revenue');
    if v_inc is not null then
      r := party_invoice(v_co, g.agent_id, 'customer', coalesce(g.group_date, current_date), null,
             'Visa ' || coalesce(g.group_no,'') || ' — ' || coalesce(g.group_name,''),
             v_sell, v_inc, 0, g.group_no, true, v_cc, null);
    end if;
  end if;

  -- Supplier bill: Dr Visa Cost / Cr <mapped supplier account>.
  if v_sup is not null and v_cost > 0 then
    v_exp := acct_ensure_named(v_co, 'Visa Cost', 'expense', '5', 'COGS');
    if v_exp is not null then
      lines := jsonb_build_array(
        jsonb_build_object('account_id', v_exp::text, 'debit', v_cost, 'credit', 0,
          'description', 'Visa cost ' || coalesce(g.group_no,''), 'cost_center', v_cc),
        jsonb_build_object('account_id', v_sup::text, 'debit', 0, 'credit', v_cost,
          'description', 'Visa ' || coalesce(g.group_no,'') || ' — ' || coalesce(g.group_name,'')));
      perform gl_post(v_co, coalesce(g.group_date, current_date),
        'Visa cost ' || coalesce(g.group_no,''), 'gl_visa_cost', g.group_no, lines);
    end if;
  end if;

  update umrah_groups set gl_invoiced_at = now() where id = p_group;
  return jsonb_build_object('posted', true, 'product', v_prod, 'nights', v_nights, 'sell', v_sell, 'cost', v_cost);
end $$;

grant execute on function visa_group_post_gl(uuid) to authenticated;
