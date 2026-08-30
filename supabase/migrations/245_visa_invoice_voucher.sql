-- 245_visa_invoice_voucher.sql
-- A real "Visa Invoice" voucher: auto-created when a group is created, editable
-- (discount / rate / date), printable, and it drives the GL. Editing re-posts the
-- GL (void old + repost) unless a receipt has already been allocated to it.

create table if not exists visa_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  group_id uuid unique references umrah_groups(id) on delete set null,
  doc_no text not null,
  doc_date date not null default current_date,
  agent_id uuid,                       -- customer (party)
  supplier_account_id uuid,            -- supplier ledger (chart of accounts)
  product_id uuid references acct_products(id),
  item_name text,
  visa_type text,
  nights int not null default 0,
  pax int not null default 0,
  sell_rate numeric(18,2) not null default 0,
  purchase_rate numeric(18,2) not null default 0,
  gross_sell numeric(18,2) not null default 0,
  discount numeric(18,2) not null default 0,
  sell_amount numeric(18,2) not null default 0,   -- net = gross - discount
  cost_amount numeric(18,2) not null default 0,
  narration text,
  haji_name text,                      -- = group name
  status text not null default 'draft',
  gl_sales_entry uuid,
  gl_purchase_entry uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_visa_invoices on visa_invoices(company_id, doc_no);
alter table visa_invoices enable row level security;
drop policy if exists visa_invoices_staff on visa_invoices;
create policy visa_invoices_staff on visa_invoices for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- Post the GL for an invoice (customer sale net of discount + supplier cost).
create or replace function visa_invoice_post(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v visa_invoices; v_inc uuid; v_exp uuid; r jsonb; lines jsonb; g jsonb; v_cc text := 'UMRAH VISA';
begin
  select * into v from visa_invoices where id = p_id;
  if not found then return; end if;
  if v.gl_sales_entry is not null or v.gl_purchase_entry is not null then return; end if;

  if v.agent_id is not null and v.sell_amount > 0 then
    v_inc := acct_ensure_named(v.company_id, 'Visa Sales', 'income', '4', 'Revenue');
    if v_inc is not null then
      r := party_invoice(v.company_id, v.agent_id, 'customer', v.doc_date, null,
             coalesce(v.narration, 'Visa ' || coalesce(v.doc_no,'')), v.sell_amount, v_inc, 0, v.doc_no, true, v_cc, null);
      update visa_invoices set gl_sales_entry = (select entry_id from open_items where id = (r->>'open_item_id')::uuid)
        where id = p_id;
    end if;
  end if;

  if v.supplier_account_id is not null and v.cost_amount > 0 then
    v_exp := acct_ensure_named(v.company_id, 'Visa Cost', 'expense', '5', 'COGS');
    if v_exp is not null then
      lines := jsonb_build_array(
        jsonb_build_object('account_id', v_exp::text, 'debit', v.cost_amount, 'credit', 0, 'description', 'Visa cost ' || coalesce(v.doc_no,''), 'cost_center', v_cc),
        jsonb_build_object('account_id', v.supplier_account_id::text, 'debit', 0, 'credit', v.cost_amount, 'description', coalesce(v.haji_name, v.doc_no)));
      g := gl_post(v.company_id, v.doc_date, 'Visa cost ' || coalesce(v.doc_no,''), 'gl_visa_cost', v.doc_no, lines);
      update visa_invoices set gl_purchase_entry = (g->>'entry_id')::uuid where id = p_id;
    end if;
  end if;

  update visa_invoices set status = 'posted', updated_at = now() where id = p_id;
end $$;

-- Reverse the GL for an invoice. Blocks if a receipt was allocated to it.
create or replace function visa_invoice_unpost(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v visa_invoices; v_oi uuid;
begin
  select * into v from visa_invoices where id = p_id;
  if not found then return; end if;
  if v.gl_sales_entry is not null then
    select id into v_oi from open_items where entry_id = v.gl_sales_entry limit 1;
    if v_oi is not null and exists (select 1 from allocations where open_item_id = v_oi) then
      raise exception 'This invoice has receipts allocated — clear them before editing.';
    end if;
    delete from open_items where entry_id = v.gl_sales_entry;
    delete from journal_lines where entry_id = v.gl_sales_entry;
    delete from journal_entries where id = v.gl_sales_entry;
  end if;
  if v.gl_purchase_entry is not null then
    delete from journal_lines where entry_id = v.gl_purchase_entry;
    delete from journal_entries where id = v.gl_purchase_entry;
  end if;
  update visa_invoices set gl_sales_entry = null, gl_purchase_entry = null where id = p_id;
end $$;

-- Create the invoice for a group (idempotent) and post it.
create or replace function visa_invoice_generate(p_group uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare g umrah_groups; v_id uuid; v_nights int; v_prod uuid; v_pname text; v_sup uuid;
        v_sell numeric(18,2); v_pur numeric(18,2); v_no text;
begin
  select * into g from umrah_groups where id = p_group;
  if not found then return null; end if;
  select id into v_id from visa_invoices where group_id = p_group;
  if v_id is not null then return v_id; end if;
  if coalesce(g.pax,0) <= 0 then return null; end if;

  v_nights := coalesce(g.total_nights,
    case when g.covered_from is not null and g.covered_to is not null then (g.covered_to - g.covered_from) else 0 end);
  v_prod := visa_pick_product(g.company_id, g.visa_type, v_nights);
  if v_prod is null then return null; end if;
  select name into v_pname from acct_products where id = v_prod;
  v_sup  := (select supplier_account_id from group_companies where id = g.group_company_id);
  v_sell := visa_sell_rate(g.company_id, v_prod, g.agent_id, v_nights);
  v_pur  := visa_purchase_rate(g.company_id, v_prod, v_sup);

  insert into doc_sequences(company_id, doc_type, prefix)
    values (g.company_id, 'visa_invoice', 'VI-') on conflict (company_id, doc_type) do nothing;
  v_no := next_doc_number(g.company_id, 'visa_invoice');

  insert into visa_invoices(company_id, group_id, doc_no, doc_date, agent_id, supplier_account_id, product_id,
    item_name, visa_type, nights, pax, sell_rate, purchase_rate, gross_sell, discount, sell_amount, cost_amount, haji_name)
  values (g.company_id, p_group, v_no, coalesce(g.group_date, current_date), g.agent_id, v_sup, v_prod,
    v_pname, g.visa_type, v_nights, g.pax, v_sell, v_pur, round(v_sell*g.pax,2), 0, round(v_sell*g.pax,2), round(v_pur*g.pax,2), g.group_name)
  returning id into v_id;

  perform visa_invoice_post(v_id);
  return v_id;
end $$;

-- Save edits (date / discount / rates / narration) and re-post the GL.
create or replace function visa_invoice_save(p_id uuid, p_doc_date date, p_discount numeric,
  p_sell_rate numeric, p_purchase_rate numeric, p_narration text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v visa_invoices;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  select * into v from visa_invoices where id = p_id and company_id = auth_company_id();
  if not found then raise exception 'Invoice not found'; end if;
  perform visa_invoice_unpost(p_id);
  update visa_invoices set
    doc_date = coalesce(p_doc_date, doc_date),
    discount = round(coalesce(p_discount, 0), 2),
    sell_rate = round(coalesce(p_sell_rate, sell_rate), 2),
    purchase_rate = round(coalesce(p_purchase_rate, purchase_rate), 2),
    narration = p_narration,
    gross_sell = round(coalesce(p_sell_rate, sell_rate) * pax, 2),
    sell_amount = round(coalesce(p_sell_rate, sell_rate) * pax - round(coalesce(p_discount,0),2), 2),
    cost_amount = round(coalesce(p_purchase_rate, purchase_rate) * pax, 2),
    updated_at = now()
  where id = p_id;
  perform visa_invoice_post(p_id);
  return (select to_jsonb(x) from visa_invoices x where x.id = p_id);
end $$;

create or replace function visa_invoice_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform visa_invoice_unpost(p_id);
  delete from visa_invoices where id = p_id and company_id = auth_company_id();
end $$;

-- Point the group-create trigger at the invoice generator (was direct GL post).
create or replace function visa_group_autopost()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
  begin
    perform visa_invoice_generate(new.id);
  exception when others then
    get stacked diagnostics v_err = message_text;
    begin
      insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
      values (new.company_id, auth.uid(), 'visa_autopost_failed', 'umrah_group', new.id,
              jsonb_build_object('group_no', new.group_no, 'error', v_err));
    exception when others then null; end;
  end;
  return new;
end $$;

grant execute on function visa_invoice_generate(uuid) to authenticated;
grant execute on function visa_invoice_post(uuid) to authenticated;
grant execute on function visa_invoice_unpost(uuid) to authenticated;
grant execute on function visa_invoice_save(uuid, date, numeric, numeric, numeric, text) to authenticated;
grant execute on function visa_invoice_delete(uuid) to authenticated;
