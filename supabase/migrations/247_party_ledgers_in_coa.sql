-- 247_party_ledgers_in_coa.sql
-- #25 — every customer / supplier appears in the Chart of Accounts. The CUSTOMERS
-- (1-04-01) and SUPPLIERS (2-01-01) groups already exist; parties only got a
-- ledger on first invoice. Now each party gets its ledger immediately on creation
-- (b2b agents count as customers), and we backfill all existing active parties.

create or replace function party_ensure_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform ensure_party_account(new.company_id, new.id,
      case when new.party_type = 'supplier' then 'supplier' else 'customer' end);
  exception when others then null;  -- never block party creation
  end;
  return new;
end $$;

drop trigger if exists trg_party_ensure_ledger on parties;
create trigger trg_party_ensure_ledger after insert on parties
  for each row execute function party_ensure_ledger();

-- Backfill existing active parties.
do $$
declare p record;
begin
  for p in select id, company_id, party_type from parties where is_active loop
    begin
      perform ensure_party_account(p.company_id, p.id,
        case when p.party_type = 'supplier' then 'supplier' else 'customer' end);
    exception when others then null;
    end;
  end loop;
end $$;
