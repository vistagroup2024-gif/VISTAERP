-- 283_rls_close_exposed_tables.sql
-- Twenty-four tables were readable by anyone holding the anon key.
--
-- The anon key is public by design — it ships in the browser, and it is in
-- .env.example in a public repository. Everything that protects Vista's data
-- from it is Row Level Security. On these tables RLS was never switched on, so
-- there was nothing between the internet and the rows.
--
-- Two of them mattered a great deal:
--
--   b2b_agent_users     username + password_hash for every B2B portal login
--   transport_sessions  live session tokens for the vendor and driver portals
--
-- A session token is worse than a password hash: it is not a secret to be
-- cracked, it is a working login. Both are closed here.
--
-- Enabling RLS with no policy at all is the right answer for a table that only
-- SECURITY DEFINER functions touch, because a definer function runs as its
-- owner and is not subject to RLS. Every function that reads or writes
-- b2b_agent_users and transport_sessions is a definer function — all 23 of
-- them, login_b2b / login_driver / login_transport / b2b_me / transport_me and
-- the rest — and no application code reads either table directly. So the
-- portals keep working exactly as they did, and the anon key gets nothing.
--
-- Two tables DO get a policy, because staff screens read them directly:
-- transport_reposition_requests (the Operations board) and
-- transport_driver_movements (the driver dashboard's live refresh). Both are
-- company-scoped staff operational data, so they get the same
-- company + is_staff() read policy every other staff table has. Writes stay
-- with their definer functions.
--
-- The backup_* tables are one-off snapshots kept from past data cleanups. No
-- code reads them. They are closed outright rather than dropped — deleting
-- someone's safety copies is not this migration's decision to make.

-- ---------------------------------------------------------------------------
-- 1. Credentials and sessions. Definer-only: RLS on, no policies.
-- ---------------------------------------------------------------------------
alter table b2b_agent_users    enable row level security;
alter table transport_sessions enable row level security;

-- Bookkeeping tables written only by the reminder routines. Same treatment.
alter table tafweej_reminder_sent   enable row level security;
alter table hotel_hcn_reminder_sent enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Staff operational data read directly by a screen. RLS on, staff read.
-- ---------------------------------------------------------------------------
alter table transport_reposition_requests enable row level security;
drop policy if exists transport_reposition_staff_read on transport_reposition_requests;
create policy transport_reposition_staff_read on transport_reposition_requests
  for select to authenticated
  using (company_id = auth_company_id() and is_staff());

alter table transport_driver_movements enable row level security;
drop policy if exists transport_driver_movements_staff_read on transport_driver_movements;
create policy transport_driver_movements_staff_read on transport_driver_movements
  for select to authenticated
  using (company_id = auth_company_id() and is_staff());

-- ---------------------------------------------------------------------------
-- 3. Cleanup snapshots. Nothing reads them; close them all.
-- ---------------------------------------------------------------------------
alter table backup_bills_removed              enable row level security;
alter table backup_bill_lines_removed         enable row level security;
alter table backup_bill_links_removed         enable row level security;
alter table backup_journal_entries_removed    enable row level security;
alter table backup_journal_lines_removed      enable row level security;
alter table backup_payments_removed           enable row level security;
alter table backup_payment_entries_removed    enable row level security;
alter table backup_payment_lines_removed      enable row level security;
alter table backup_transport_entry_fix        enable row level security;
alter table backup_clean_car_vehicles         enable row level security;
alter table backup_clean_car_contracts        enable row level security;
alter table backup_clean_car_installments     enable row level security;
alter table backup_clean_car_service_charges  enable row level security;
alter table backup_clean_car_commissions      enable row level security;
alter table backup_clean_car_purchase_orders  enable row level security;
alter table backup_clean_car_po_items         enable row level security;
alter table backup_clean_journal_entries      enable row level security;
alter table backup_clean_journal_lines        enable row level security;

-- ---------------------------------------------------------------------------
-- Anyone who held a token or hash read out of these tables before today still
-- holds it. Rotating the B2B portal passwords and expiring the outstanding
-- vendor/driver sessions is a separate, deliberate decision for Vista Group to
-- make — this migration closes the door but does not change anyone's
-- credentials underneath them.
-- ---------------------------------------------------------------------------
