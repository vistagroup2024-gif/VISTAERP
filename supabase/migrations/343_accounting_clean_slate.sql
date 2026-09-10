-- Clear the accounting transactions and start the books from zero.
--
-- DESTRUCTIVE. Read this header before running it.
--
-- WHAT GOES. Every accounting TRANSACTION: 220 journal entries and their 632
-- lines, 38 open items, 33 visa invoices, 43 acct_audit rows, the 6 trade
-- documents and their lines, the 6 stock movements and 1 stock balance, and the
-- 1 payroll run. That is the whole ledger as it stands.
--
-- WHAT STAYS. Every master and configuration record: the 177 accounts, 39
-- parties, 8 products, cost centres, tag areas, employees, hotels, transport
-- routes/vendors/rates, agents, currencies, companies, workflow steps, approval
-- rules, and doc_sequences — the numbering counters are deliberately NOT reset,
-- so no invoice number is ever issued twice.
--
-- WHAT IS NOT TOUCHED AT ALL: the Umrah Group module. 388 groups, 1,148 BRN
-- allocations, 1,186 consumption rows, 264 attachments, 133 BRN inventory rows,
-- 411 company reservations, 416 transport bookings, 740 trips, 13 hotel
-- bookings, 25 purchase bookings, 33 stay rooms, 141 package updates. Every
-- foreign key between accounting and groups points INTO umrah_groups, never out
-- (visa_invoices.group_id is ON DELETE SET NULL), so deleting an invoice cannot
-- reach a group. Nothing here deletes from a group table, and the post-condition
-- at the end refuses to commit if any group count moved.
--
-- REVERSIBLE. Every deleted row is copied into a _cleanup_343_* table first.
-- 343_rollback puts them back. The backups are kept until somebody drops them
-- on purpose — a few hundred rows is nothing, and the day you want them back is
-- the day you would regret having tidied them away.
--
-- ORDER IS FORCED. open_items.entry_id is ON DELETE NO ACTION, so open items go
-- before journal entries. journal_lines cascade from entries and need no
-- separate delete. allocations, car_vehicle_expenses, pdc_register and
-- pending_vouchers also reference entries but are all empty; the guard below
-- checks that rather than assuming it.
--
-- RUN 342 FIRST. With the automation still live, completing a trip or confirming
-- a hotel booking re-posts immediately and you would be cleaning again an hour
-- later. 342 seeds every rule OFF; this migration refuses to run without it.

begin;

-- ── refuse to run on unsafe ground ─────────────────────────────────────────
do $guard$
declare n int;
begin
  if to_regclass('public.acct_automation_rules') is null then
    raise exception '343: run 342 first — automation must be switchable before the books are cleared';
  end if;
  select count(*) into n from acct_automation_rules where enabled;
  if n > 0 then
    raise exception '343: % automation rule(s) are still ON — turn them off first or the ledger refills', n;
  end if;
  -- these reference journal_entries with NO ACTION and would block the delete
  select (select count(*) from allocations) + (select count(*) from car_vehicle_expenses)
       + (select count(*) from pdc_register) + (select count(*) from pending_vouchers)
       + (select count(*) from bank_lines) into n;
  if n > 0 then
    raise exception '343: % blocking row(s) in allocations/car_vehicle_expenses/pdc_register/pending_vouchers/bank_lines — handle these first', n;
  end if;
end $guard$;

-- ── remember the group counts, to prove nothing moved ──────────────────────
create temporary table _grp_before on commit drop as
select 'umrah_groups' t, count(*) n from umrah_groups
union all select 'group_brn_allocation', count(*) from group_brn_allocation
union all select 'group_attachments', count(*) from group_attachments
union all select 'brn_consumption', count(*) from brn_consumption
union all select 'brn_inventory', count(*) from brn_inventory
union all select 'company_reservations', count(*) from company_reservations
union all select 'transport_bookings', count(*) from transport_bookings
union all select 'transport_trips', count(*) from transport_trips
union all select 'hotel_bookings', count(*) from hotel_bookings
union all select 'hotel_purchase_bookings', count(*) from hotel_purchase_bookings
union all select 'hotel_stay_rooms', count(*) from hotel_stay_rooms
union all select 'package_update_history', count(*) from package_update_history
union all select 'accounts', count(*) from accounts
union all select 'parties', count(*) from parties
union all select 'acct_products', count(*) from acct_products
union all select 'doc_sequences', count(*) from doc_sequences;

-- ── back up everything before deleting it ──────────────────────────────────
create table if not exists public._cleanup_343_journal_entries      as table journal_entries      with no data;
create table if not exists public._cleanup_343_journal_lines        as table journal_lines        with no data;
create table if not exists public._cleanup_343_open_items           as table open_items           with no data;
create table if not exists public._cleanup_343_visa_invoices        as table visa_invoices        with no data;
create table if not exists public._cleanup_343_acct_audit           as table acct_audit           with no data;
create table if not exists public._cleanup_343_trade_documents      as table trade_documents      with no data;
create table if not exists public._cleanup_343_trade_document_lines as table trade_document_lines with no data;
create table if not exists public._cleanup_343_stock_movements      as table stock_movements      with no data;
create table if not exists public._cleanup_343_stock_balances       as table stock_balances       with no data;
create table if not exists public._cleanup_343_payroll_runs         as table payroll_runs         with no data;
create table if not exists public._cleanup_343_payslips             as table payslips             with no data;

insert into public._cleanup_343_journal_lines        select * from journal_lines;
insert into public._cleanup_343_journal_entries      select * from journal_entries;
insert into public._cleanup_343_open_items           select * from open_items;
insert into public._cleanup_343_visa_invoices        select * from visa_invoices;
insert into public._cleanup_343_acct_audit           select * from acct_audit;
insert into public._cleanup_343_trade_document_lines select * from trade_document_lines;
insert into public._cleanup_343_trade_documents      select * from trade_documents;
insert into public._cleanup_343_stock_movements      select * from stock_movements;
insert into public._cleanup_343_stock_balances       select * from stock_balances;
insert into public._cleanup_343_payroll_runs         select * from payroll_runs;
insert into public._cleanup_343_payslips             select * from payslips;

-- the backups hold the company's whole ledger: staff have no business reading
-- them through the API, so nothing is granted and RLS is on with no policy.
alter table public._cleanup_343_journal_entries      enable row level security;
alter table public._cleanup_343_journal_lines        enable row level security;
alter table public._cleanup_343_open_items           enable row level security;
alter table public._cleanup_343_visa_invoices        enable row level security;
alter table public._cleanup_343_acct_audit           enable row level security;
alter table public._cleanup_343_trade_documents      enable row level security;
alter table public._cleanup_343_trade_document_lines enable row level security;
alter table public._cleanup_343_stock_movements      enable row level security;
alter table public._cleanup_343_stock_balances       enable row level security;
alter table public._cleanup_343_payroll_runs         enable row level security;
alter table public._cleanup_343_payslips             enable row level security;

-- ── release the pointers the operational rows hold into the ledger ─────────
-- These are UPDATEs on operational tables, not deletes: a trip keeps its route,
-- date, vehicle and driver and simply reads as "not yet posted" again.
update transport_trips           set gl_entry = null, gl_posted_at = null where gl_entry is not null;
update hotel_purchase_bookings   set gl_posted_at = null, gl_sales_entry = null, gl_purchase_entry = null
                                 where gl_posted_at is not null;
-- car_contracts carries no gl_* column: the car postings are tied to the
-- contract only through journal_entries.reference, so deleting the entry is
-- the whole of it and the contract row itself is untouched.

-- ── delete, in the order the foreign keys allow ────────────────────────────
delete from open_items;                 -- NO ACTION on entry_id: must precede entries
delete from visa_invoices;              -- group_id is ON DELETE SET NULL: groups unaffected
delete from stock_movements;
delete from stock_balances;
delete from trade_document_lines;
delete from trade_documents;
delete from payslips;                    -- payslips.run_id references payroll_runs
delete from payroll_runs;
delete from acct_audit;
delete from journal_entries;            -- journal_lines cascade

-- ── prove the Umrah Group module and the masters did not move ──────────────
do $chk$
declare bad text;
begin
  select string_agg(t || ': ' || b.n || ' -> ' || a.n, ', ')
    into bad
  from _grp_before b
  join (
    select 'umrah_groups' t, count(*) n from umrah_groups
    union all select 'group_brn_allocation', count(*) from group_brn_allocation
    union all select 'group_attachments', count(*) from group_attachments
    union all select 'brn_consumption', count(*) from brn_consumption
    union all select 'brn_inventory', count(*) from brn_inventory
    union all select 'company_reservations', count(*) from company_reservations
    union all select 'transport_bookings', count(*) from transport_bookings
    union all select 'transport_trips', count(*) from transport_trips
    union all select 'hotel_bookings', count(*) from hotel_bookings
    union all select 'hotel_purchase_bookings', count(*) from hotel_purchase_bookings
    union all select 'hotel_stay_rooms', count(*) from hotel_stay_rooms
    union all select 'package_update_history', count(*) from package_update_history
    union all select 'accounts', count(*) from accounts
    union all select 'parties', count(*) from parties
    union all select 'acct_products', count(*) from acct_products
    union all select 'doc_sequences', count(*) from doc_sequences
  ) a using (t)
  where a.n <> b.n;

  if bad is not null then
    raise exception '343: protected data changed — %  ROLLING BACK', bad;
  end if;

  if (select count(*) from journal_entries) <> 0 then raise exception '343: journal not empty'; end if;
  if (select count(*) from journal_lines)   <> 0 then raise exception '343: journal lines not empty'; end if;
  if (select count(*) from _cleanup_343_journal_entries) = 0 then raise exception '343: backup is empty'; end if;
end $chk$;

-- one line in the ERP's own audit log, so the clearing is on the record
insert into audit_log(company_id, user_id, action, entity, entity_id, detail)
select c.id, auth.uid(), 'accounting_cleared', 'company', c.id,
       jsonb_build_object(
         'journal_entries', (select count(*) from _cleanup_343_journal_entries),
         'journal_lines',   (select count(*) from _cleanup_343_journal_lines),
         'open_items',      (select count(*) from _cleanup_343_open_items),
         'visa_invoices',   (select count(*) from _cleanup_343_visa_invoices),
         'trade_documents', (select count(*) from _cleanup_343_trade_documents),
         'backup_prefix',   '_cleanup_343_')
from companies c;

commit;
