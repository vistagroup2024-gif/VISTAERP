-- 253_transport_supplier_ledgers.sql
-- Put transport vendors into the Chart of Accounts under a dedicated
-- "TRANSPORT SUPPLIERS" group (child of SUPPLIERS, 2-01-01). Each vendor gets a
-- payable ledger there, linked back via transport_vendors.account_id. New vendors
-- get one automatically. Used as the supplier for outsourced-transport invoices.

alter table transport_vendors add column if not exists account_id uuid references accounts(id);

-- Ensure a group account with a given name under a parent (by code); returns id.
create or replace function acct_ensure_group(p_company uuid, p_name text, p_parent_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare par accounts%rowtype; v_id uuid; v_seq int; v_code text;
begin
  select id into v_id from accounts where company_id = p_company and is_group = true and upper(name) = upper(p_name)
    order by code limit 1;
  if v_id is not null then return v_id; end if;
  select * into par from accounts where company_id = p_company and code = p_parent_code;
  if not found then return null; end if;
  select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
    from accounts where company_id = p_company and parent_id = par.id and code ~ '-[0-9]+$';
  v_code := par.code || '-' || lpad(coalesce(v_seq,1)::text, 2, '0');
  insert into accounts(company_id, code, name, type, is_postable, is_group, parent_id, subtype)
  values (p_company, v_code, p_name, par.type, false, true, par.id, 'Payable')
  returning id into v_id;
  perform acct_rebuild_paths(p_company);
  return v_id;
end $$;

-- Ensure a payable ledger for a transport vendor under TRANSPORT SUPPLIERS.
create or replace function ensure_transport_vendor_account(p_company uuid, p_vendor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v transport_vendors%rowtype; grp uuid; par accounts%rowtype; v_id uuid; v_seq int; v_code text;
begin
  select * into v from transport_vendors where id = p_vendor and company_id = p_company;
  if not found then raise exception 'Vendor not found'; end if;
  if v.account_id is not null then return v.account_id; end if;

  grp := acct_ensure_group(p_company, 'TRANSPORT SUPPLIERS', '2-01-01');
  if grp is null then return null; end if;
  select * into par from accounts where id = grp;

  select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
    from accounts where company_id = p_company and parent_id = grp and code ~ '-[0-9]+$';
  v_code := par.code || '-' || lpad(coalesce(v_seq,1)::text, 3, '0');
  insert into accounts(company_id, code, name, type, is_postable, is_group, parent_id, subtype, currency, phone)
  values (p_company, v_code, v.name, 'liability', true, false, grp, 'Payable', 'SAR', v.mobile)
  returning id into v_id;
  update transport_vendors set account_id = v_id where id = p_vendor;
  perform acct_rebuild_paths(p_company);
  return v_id;
end $$;

-- Auto-create the ledger for new vendors.
create or replace function transport_vendor_ensure_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform ensure_transport_vendor_account(new.company_id, new.id); exception when others then null; end;
  return new;
end $$;
drop trigger if exists trg_transport_vendor_ledger on transport_vendors;
create trigger trg_transport_vendor_ledger after insert on transport_vendors
  for each row execute function transport_vendor_ensure_ledger();

grant execute on function acct_ensure_group(uuid, text, text) to authenticated;
grant execute on function ensure_transport_vendor_account(uuid, uuid) to authenticated;

-- Backfill all existing vendors.
do $$
declare v record;
begin
  for v in select id, company_id from transport_vendors loop
    begin perform ensure_transport_vendor_account(v.company_id, v.id); exception when others then null; end;
  end loop;
end $$;
