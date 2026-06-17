# Vista ERP

ERP for **Vista Group** — Umrah Services & Trading (B2B + B2C). Built with
**Next.js 14 (App Router) + Supabase (Postgres, Auth, RLS)** and Tailwind CSS.

## Modules

| Status | Module | Notes |
|--------|--------|-------|
| ✅ MVP | Core | Companies, branches, roles/permissions, currencies, FX, parties, doc numbering |
| ✅ MVP | Hotel & Inventory | Hotels, room types, seasons, rates, **allotments** (bulk-held rooms) |
| ✅ MVP | Packages | Package builder bundling **Visa + Transport + Air ticket + Hotel** line items (cost & sell, multi-currency) |
| ✅ MVP | Sales / Bookings | Booking workflow (held → confirmed → traveled → closed), passengers, services, invoice generation |
| ✅ MVP | B2B Partner Portal | Agents browse active packages, view their bookings & invoice/ledger balance |
| 🔜 Next | Accounting | Chart of accounts, ledgers, AR/AP, payments/receipts |
| 🔜 | Purchase | Supplier POs & bills (hotels, transport, visa, airlines) |
| 🔜 | Inventory | Generalized tradable goods |
| 🔜 | HR | Employees, attendance, payroll |

Tax/compliance (Saudi ZATCA e-invoicing) is **deferred** — invoice table already
reserves `tax_rate`, `tax_amount`, `einvoice_uuid`, `einvoice_qr`, and
`companies.einvoice_meta` so adding it later won't require schema rework.

## Getting started

```bash
npm install
cp .env.example .env.local   # values already point to the Vista Supabase project
npm run dev
```

Open http://localhost:3000.

### Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_DEFAULT_COMPANY_ID` — the seeded Vista Group company id

## Bootstrapping the first admin

Row-Level Security hides all company data until a user has a role **and** a
`company_id` on their profile. After signing up via `/signup`, run this once in
the Supabase SQL editor (replace the email):

```sql
-- 1. attach the user to Vista Group
update profiles
set company_id = '96f6b539-b491-4df7-91a2-80c7c8e7491d'
where id = (select id from auth.users where email = 'you@example.com');

-- 2. grant the admin role
insert into user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com';
```

To onboard a **B2B agent**: create a party of type `b2b_agent`, create their
auth user, set `parties.portal_user_id` to that user id, and grant the
`b2b_agent` role. They then sign in and land on `/portal`.

## Database

Migrations live in `supabase/migrations/` and are already applied to the linked
project:

1. `001_core_foundation.sql`
2. `002_hotel_booking_sales.sql`
3. `003_rls_functions_security.sql` — helper functions + RLS policies
4. `004_seed_company_demo.sql` — Vista Group + demo hotels/package/allotment

Regenerate types after schema changes:

```bash
supabase gen types typescript --project-id <ref> > lib/database.types.ts
```

## Roles

`admin, accounting, hr, sales, purchase, inventory, hotel_ops` (internal staff)
and `b2b_agent` (portal). Staff see everything in their company; agents see only
their own bookings/invoices and active packages.
