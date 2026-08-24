-- ============================================================
-- VISTA ERP — Accounting rebuild, PHASE 3 (schema)
-- Receivables / Payables: party ledger accounts + master fields, invoice-wise
-- OPEN ITEMS + allocations, and the PDC register.
-- ============================================================

-- Party link + master extension fields on the account (spec §3.1).
alter table accounts add column if not exists party_id     uuid references parties(id) on delete set null;
alter table accounts add column if not exists phone        text;
alter table accounts add column if not exists iqama_expiry date;
alter table accounts add column if not exists vat_no       text;
alter table accounts add column if not exists credit_limit numeric(18,2) not null default 0;
alter table accounts add column if not exists credit_days  int not null default 0;
create index if not exists idx_accounts_party on accounts(company_id, party_id);

-- OPEN ITEMS: one row per invoice/bill on a party account; reduced by allocations.
create table if not exists open_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  account_id uuid not null references accounts(id),        -- the party leaf account
  party_id uuid references parties(id),
  direction char(1) not null,                              -- 'D' receivable invoice, 'C' payable bill
  doc_type text not null,
  doc_no text,
  doc_date date not null default current_date,
  due_date date,
  currency char(3) not null default 'SAR',
  amount_base numeric(18,2) not null,                      -- original amount (base SAR)
  outstanding_base numeric(18,2) not null,                 -- remaining
  entry_id uuid references journal_entries(id),
  status text not null default 'open',                     -- open / settled
  created_at timestamptz not null default now()
);
create index if not exists idx_open_items_acct on open_items(company_id, account_id, status, doc_date);

create table if not exists allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  open_item_id uuid not null references open_items(id) on delete cascade,
  settle_entry_id uuid references journal_entries(id),
  amount_base numeric(18,2) not null,
  note text,
  at timestamptz not null default now()
);
create index if not exists idx_allocations_item on allocations(open_item_id);

-- PDC register: post-dated cheques received / issued and their lifecycle.
create table if not exists pdc_register (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  direction text not null,             -- 'received' / 'issued'
  party_account_id uuid references accounts(id),
  bank_account_id uuid references accounts(id),
  cheque_no text,
  bank_name text,
  amount_base numeric(18,2) not null,
  cheque_date date,                    -- maturity
  status text not null default 'in_hand',  -- in_hand / deposited / cleared / bounced / cancelled
  narration text,
  in_entry_id uuid references journal_entries(id),   -- entry on receipt/issue
  clear_entry_id uuid references journal_entries(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_pdc_feed on pdc_register(company_id, status, cheque_date);

alter table open_items    enable row level security;
alter table allocations   enable row level security;
alter table pdc_register  enable row level security;

drop policy if exists open_items_staff on open_items;
create policy open_items_staff on open_items for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());
drop policy if exists allocations_staff on allocations;
create policy allocations_staff on allocations for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());
drop policy if exists pdc_staff on pdc_register;
create policy pdc_staff on pdc_register for all to authenticated
  using (company_id = auth_company_id() and is_staff()) with check (company_id = auth_company_id() and is_staff());

-- Find or auto-create a party's ledger account under the right control group.
-- customer → CUSTOMERS (1-04-01), supplier → SUPPLIERS (2-01-01). (spec automation #1)
create or replace function ensure_party_account(p_company uuid, p_party uuid, p_kind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_acc uuid; par accounts%rowtype; v_seq int; v_code text; pr parties%rowtype; v_parent_code text; v_subtype text; v_nature account_type;
begin
  select * into pr from parties where id = p_party and company_id = p_company;
  if not found then raise exception 'Party not found'; end if;

  select id into v_acc from accounts where company_id = p_company and party_id = p_party
    and subtype = case when p_kind = 'supplier' then 'Payable' else 'Receivable' end limit 1;
  if v_acc is not null then return v_acc; end if;

  if p_kind = 'supplier' then v_parent_code := '2-01-01'; v_subtype := 'Payable'; v_nature := 'liability';
  else v_parent_code := '1-04-01'; v_subtype := 'Receivable'; v_nature := 'asset'; end if;

  select * into par from accounts where company_id = p_company and code = v_parent_code;
  if not found then raise exception 'Control group % missing — seed the chart', v_parent_code; end if;

  select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1 into v_seq
    from accounts where company_id = p_company and parent_id = par.id and code ~ '-[0-9]+$';
  v_code := par.code || '-' || lpad(coalesce(v_seq,1)::text, 3, '0');

  insert into accounts(company_id, code, name, type, is_postable, is_group, parent_id, subtype,
                       currency, party_id, phone, vat_no, credit_limit)
  values (p_company, v_code, pr.name, v_nature, true, false, par.id, v_subtype,
          coalesce(pr.currency,'SAR'), p_party, pr.phone, pr.tax_number, coalesce(pr.credit_limit,0))
  returning id into v_acc;
  return v_acc;
end $$;

grant execute on function ensure_party_account(uuid,uuid,text) to authenticated;
