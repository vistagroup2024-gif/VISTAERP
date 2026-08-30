-- 243_visa_auto_invoice.sql
-- Auto-generate the accounting invoice for a Visa group when the group is
-- created, and post the GL both sides — customer (agent) and supplier (visa
-- provider / group company). Pricing comes from the Product Tree: the product
-- whose name matches the group's visa_type supplies the sell rate (customer)
-- and purchase rate (supplier). Quantity = pax, one product per group.
--
-- The existing "Visa Invoices" tick tab (external-software cross-check) is left
-- untouched; this posts to the real GL in parallel via a separate marker.

-- Markers so we post once and can trace the GL entries back to the group.
alter table umrah_groups add column if not exists gl_invoiced_at timestamptz;
alter table umrah_groups add column if not exists gl_sales_entry uuid;
alter table umrah_groups add column if not exists gl_purchase_entry uuid;

-- Optional explicit link from a group company (visa supplier) to its supplier
-- party ledger; when null we fall back to matching the party by name.
alter table group_companies add column if not exists supplier_party_id uuid references parties(id);

-- Ensure a named account under a root group (income/expense), next free code.
create or replace function acct_ensure_named(p_company uuid, p_name text, p_type account_type, p_root text, p_subtype text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; par accounts%rowtype; v_seq int; v_code text;
begin
  select id into v_id from accounts where company_id = p_company and type = p_type and upper(name) = upper(p_name)
    and is_postable order by code limit 1;
  if v_id is not null then return v_id; end if;
  select * into par from accounts where company_id = p_company and code = p_root;
  if not found then return null; end if;
  select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
    from accounts where company_id = p_company and parent_id = par.id and code ~ ('^'||p_root||'-[0-9]+$');
  v_code := p_root || '-' || lpad(coalesce(v_seq,1)::text, 2, '0');
  insert into accounts(company_id, code, name, type, is_postable, is_group, parent_id, subtype)
  values (p_company, v_code, p_name, p_type, true, false, par.id, p_subtype)
  returning id into v_id;
  perform acct_rebuild_paths(p_company);
  return v_id;
end $$;

-- Resolve the supplier party for a group company: explicit link first, else an
-- existing supplier party of the same name.
create or replace function visa_supplier_party(p_company uuid, p_group_company uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select gc.supplier_party_id from group_companies gc where gc.id = p_group_company),
    (select p.id from parties p join group_companies gc on gc.id = p_group_company
       where p.company_id = p_company and p.party_type = 'supplier' and upper(p.name) = upper(gc.name)
       and p.is_active order by p.created_at limit 1)
  );
$$;

-- Post the GL invoice for one group (customer sales + supplier bill). Idempotent:
-- does nothing if already posted. Safe to call manually to backfill.
create or replace function visa_group_post_gl(p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g umrah_groups; prod acct_products; v_co uuid; v_sell numeric(18,2); v_cost numeric(18,2);
        v_inc uuid; v_exp uuid; v_sup uuid; r jsonb; v_cc text := 'UMRAH VISA';
begin
  select * into g from umrah_groups where id = p_group;
  if not found then return jsonb_build_object('posted', false, 'reason', 'group not found'); end if;
  if g.gl_invoiced_at is not null then return jsonb_build_object('posted', false, 'reason', 'already posted'); end if;
  v_co := g.company_id;
  if coalesce(g.pax,0) <= 0 then return jsonb_build_object('posted', false, 'reason', 'no pax'); end if;

  -- Price from the product whose name matches the visa type.
  select * into prod from acct_products where company_id = v_co and is_group = false and is_active
    and upper(name) = upper(coalesce(g.visa_type,'')) limit 1;
  if not found then return jsonb_build_object('posted', false, 'reason', 'no product for visa type'); end if;
  v_sell := round(coalesce(prod.sell_rate,0) * g.pax, 2);
  v_cost := round(coalesce(prod.purchase_rate,0) * g.pax, 2);

  -- Customer (agent) sales invoice: Dr agent / Cr Visa Sales.
  if g.agent_id is not null and v_sell > 0 then
    v_inc := acct_ensure_named(v_co, 'Visa Sales', 'income', '4', 'Revenue');
    if v_inc is not null then
      r := party_invoice(v_co, g.agent_id, 'customer', coalesce(g.group_date, current_date), null,
             'Visa ' || coalesce(g.group_no,'') || ' — ' || coalesce(g.group_name,''),
             v_sell, v_inc, 0, g.group_no, true, v_cc, null);
    end if;
  end if;

  -- Supplier (visa provider) bill: Dr Visa Cost / Cr Supplier.
  v_sup := visa_supplier_party(v_co, g.group_company_id);
  if v_sup is not null and v_cost > 0 then
    v_exp := acct_ensure_named(v_co, 'Visa Cost', 'expense', '5', 'COGS');
    if v_exp is not null then
      r := party_invoice(v_co, v_sup, 'supplier', coalesce(g.group_date, current_date), null,
             'Visa cost ' || coalesce(g.group_no,'') || ' — ' || coalesce(g.group_name,''),
             v_cost, v_exp, 0, g.group_no, true, v_cc, null);
    end if;
  end if;

  update umrah_groups set gl_invoiced_at = now() where id = p_group;
  return jsonb_build_object('posted', true, 'sell', v_sell, 'cost', v_cost);
end $$;

-- Fire on group creation. Exception-safe: a posting problem never blocks the
-- group insert.
create or replace function visa_group_autopost()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
  begin
    perform visa_group_post_gl(new.id);
  exception when others then
    -- Never block group creation. Log the reason so a silent miss is traceable;
    -- staff can also call visa_group_post_gl(group) manually to see it / retry.
    get stacked diagnostics v_err = message_text;
    begin
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (new.company_id, auth.uid(), 'visa_autopost_failed', 'umrah_group', new.id,
              jsonb_build_object('group_no', new.group_no, 'error', v_err));
    exception when others then null; end;
  end;
  return new;
end $$;

drop trigger if exists trg_visa_group_autopost on umrah_groups;
create trigger trg_visa_group_autopost after insert on umrah_groups
  for each row execute function visa_group_autopost();

grant execute on function visa_group_post_gl(uuid) to authenticated;
grant execute on function visa_supplier_party(uuid, uuid) to authenticated;
grant execute on function acct_ensure_named(uuid, text, account_type, text, text) to authenticated;
