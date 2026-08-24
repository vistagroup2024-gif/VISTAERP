-- ============================================================
-- VISTA ERP — Accounting rebuild, PHASE 1 (part 2)
-- Focus-style voucher number series + the seeded Vista chart-of-accounts skeleton
-- (§2.1). Idempotent: safe to re-run; never touches or deletes existing accounts.
-- ============================================================

-- Voucher number series (Jrn:643, Rct:1560 … Focus style). Pre-seed so
-- next_doc_number() keeps our chosen prefix instead of deriving one.
insert into doc_sequences(company_id, doc_type, prefix, next_number, padding)
select c.id, x.doc_type, x.prefix, 1, 1 from companies c
cross join (values
  ('gl_journal','Jrn:'), ('gl_receipt','Rct:'), ('gl_payment','Pmt:'), ('gl_contra','Cnt:')
) as x(doc_type, prefix)
on conflict (company_id, doc_type) do nothing;

-- Upsert one node (group or leaf) by code, resolving parent by code.
create or replace function acct_seed_node(
  p_company uuid, p_code text, p_name text, p_nature account_type,
  p_parent_code text, p_is_group boolean, p_subtype text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_parent uuid;
begin
  if p_parent_code is not null then
    select id into v_parent from accounts where company_id = p_company and code = p_parent_code;
  end if;
  if exists (select 1 from accounts where company_id = p_company and code = p_code) then
    return;
  end if;
  insert into accounts(company_id, code, name, type, is_postable, is_group, parent_id, subtype)
  values (p_company, p_code, p_name, p_nature, not p_is_group, p_is_group, v_parent, p_subtype);
end $$;

-- Seed the Vista group skeleton + system/control accounts.
create or replace function ensure_vista_chart(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Roots
  perform acct_seed_node(p_company,'1','ASSETS','asset',null,true);
  perform acct_seed_node(p_company,'2','LIABILITIES','liability',null,true);
  perform acct_seed_node(p_company,'3','EQUITY','equity',null,true);
  perform acct_seed_node(p_company,'4','INCOME','income',null,true);
  perform acct_seed_node(p_company,'5','EXPENSES','expense',null,true);
  perform acct_seed_node(p_company,'9','CONTROL','control',null,true);

  -- ASSETS
  perform acct_seed_node(p_company,'1-01','FIXED ASSETS','asset','1',true);
  perform acct_seed_node(p_company,'1-01-01','PROPERTY','asset','1-01',true);
  perform acct_seed_node(p_company,'1-01-01-01','VILLA 1','asset','1-01-01',false,'Fixed Asset');
  perform acct_seed_node(p_company,'1-01-01-02','VILLA 2','asset','1-01-01',false,'Fixed Asset');
  perform acct_seed_node(p_company,'1-01-02','VEHICLES','asset','1-01',true);
  perform acct_seed_node(p_company,'1-01-03','OFFICE EQUIPMENT','asset','1-01',true);
  perform acct_seed_node(p_company,'1-01-03-01','AC','asset','1-01-03',false,'Fixed Asset');
  perform acct_seed_node(p_company,'1-01-03-02','COMPUTERS','asset','1-01-03',false,'Fixed Asset');

  perform acct_seed_node(p_company,'1-02','CASH IN HAND','asset','1',true);
  perform acct_seed_node(p_company,'1-02-01','CASH','asset','1-02',false,'Cash');
  perform acct_seed_node(p_company,'1-02-02','CHEQUE IN HAND','asset','1-02',false,'Cash');
  perform acct_seed_node(p_company,'1-02-03','USD IN HAND','asset','1-02',false,'Cash');

  perform acct_seed_node(p_company,'1-03','BANK','asset','1',true);
  perform acct_seed_node(p_company,'1-03-01','BANK PKR','asset','1-03',true);
  perform acct_seed_node(p_company,'1-03-01-01','MEEZAN BANK','asset','1-03-01',false,'Bank');
  perform acct_seed_node(p_company,'1-03-01-02','CASH IN HAND (PKR)','asset','1-03-01',false,'Cash');
  perform acct_seed_node(p_company,'1-03-02','RIYAD BANK','asset','1-03',false,'Bank');
  perform acct_seed_node(p_company,'1-03-03','RAJHI BANK','asset','1-03',false,'Bank');
  perform acct_seed_node(p_company,'1-03-04','ALINMA BANK','asset','1-03',false,'Bank');

  perform acct_seed_node(p_company,'1-04','A/C RECEIVABLE','asset','1',true);
  perform acct_seed_node(p_company,'1-04-01','CUSTOMERS','asset','1-04',true);
  perform acct_seed_node(p_company,'1-04-01-01','UMRAH VISA CUSTOMERS','asset','1-04-01',true,'Receivable');
  perform acct_seed_node(p_company,'1-04-01-02','HOTEL CUSTOMERS','asset','1-04-01',true,'Receivable');
  perform acct_seed_node(p_company,'1-04-01-03','CAR TRADING CUSTOMERS','asset','1-04-01',true,'Receivable');
  perform acct_seed_node(p_company,'1-04-01-04','VISTA CAR CUSTOMERS','asset','1-04-01',true,'Receivable');

  -- LIABILITIES
  perform acct_seed_node(p_company,'2-01','A/C PAYABLE','liability','2',true);
  perform acct_seed_node(p_company,'2-01-01','SUPPLIERS','liability','2-01',true,'Payable');
  perform acct_seed_node(p_company,'2-02','TAX PAYABLE (VAT)','liability','2',false,'Tax');

  -- EQUITY
  perform acct_seed_node(p_company,'3-01','CAPITAL','equity','3',false,'Equity');
  perform acct_seed_node(p_company,'3-02','DRAWING','equity','3',true);
  perform acct_seed_node(p_company,'3-02-01','SS DRAWING','equity','3-02',false,'Drawing');
  perform acct_seed_node(p_company,'3-02-02','SS ZAKAT','equity','3-02',false,'Drawing');
  perform acct_seed_node(p_company,'3-02-03','KHUBAIB DRAWING','equity','3-02',false,'Drawing');
  perform acct_seed_node(p_company,'3-02-04','HAMMAD DRAWING','equity','3-02',false,'Drawing');

  -- INCOME
  perform acct_seed_node(p_company,'4-01','Umrah / Visa Revenue','income','4',false,'Revenue');
  perform acct_seed_node(p_company,'4-02','Ticketing Revenue','income','4',false,'Revenue');
  perform acct_seed_node(p_company,'4-03','Hotel Revenue','income','4',false,'Revenue');
  perform acct_seed_node(p_company,'4-04','Car Trading Revenue','income','4',false,'Revenue');
  perform acct_seed_node(p_company,'4-05','Transport Revenue','income','4',false,'Revenue');
  perform acct_seed_node(p_company,'4-09','Other Income','income','4',false,'Revenue');

  -- EXPENSES
  perform acct_seed_node(p_company,'5-01','Cost of Services','expense','5',false,'COGS');
  perform acct_seed_node(p_company,'5-02','Salaries & Wages','expense','5',false,'Direct Expense');
  perform acct_seed_node(p_company,'5-03','Office & Admin','expense','5',false,'Indirect Expense');
  perform acct_seed_node(p_company,'5-04','Bank Charges','expense','5',false,'Indirect Expense');
  perform acct_seed_node(p_company,'5-05','Outsourced Transport','expense','5',false,'COGS');

  -- CONTROL / system
  perform acct_seed_node(p_company,'9-01','Opening Balance Control','control','9',false);
  perform acct_seed_node(p_company,'9-02','Profit & Loss','control','9',false);
  perform acct_seed_node(p_company,'9-03','Retained Earnings','control','9',false);
  perform acct_seed_node(p_company,'9-04','Suspense','control','9',false);
  perform acct_seed_node(p_company,'9-05','Rounding','control','9',false);
  perform acct_seed_node(p_company,'9-06','FX Gain / Loss','control','9',false);
  perform acct_seed_node(p_company,'9-07','Inter-company Clearing','control','9',false);

  perform acct_rebuild_paths(p_company);
end $$;

grant execute on function ensure_vista_chart(uuid) to authenticated;

-- Seed the live Vista Group company now.
select ensure_vista_chart('96f6b539-b491-4df7-91a2-80c7c8e7491d');
select acct_rebuild_paths('96f6b539-b491-4df7-91a2-80c7c8e7491d');
