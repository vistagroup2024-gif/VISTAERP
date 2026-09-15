# VISTAERP — working notes

Next.js 14 (App Router) + Supabase. Saudi umrah / travel ERP.

## Hidden screens: unhide, never rebuild

Some screens are **hidden from the sidebar but still built, still routed and
still holding their data**. They were taken out of the menu because they are not
in use yet — not because they were wrong.

**If something like one of them is wanted again, unhide it and carry on from
what is there. Do not build a new screen alongside it.** Two half-versions of
the same idea, with the data split between them, is worse than either.

The register lives in `lib/nav.ts` as `HIDDEN_ITEMS`, next to the nav they came
out of, with a line on what each one does. To unhide, move the entry back into
its group in `GROUPS`. Currently hidden:

| Screen | Route | What it is |
|---|---|---|
| Service Catalog | `/sales/catalog` | Price list of sellable services; booking lines are priced from it |
| Visa Tracking | `/sales/visas` | Per-passenger visa status on a booking |
| Packages | `/packages` | Pre-built Umrah packages sold at one price; also read by the B2B agent portal |
| Invoices | `/invoices` | The customer invoice the booking flow raises automatically. Read-only |
| Car Sales | `/car-sales/alerts`, `/car-sales/vehicles`, `/car-sales/commissions`, `/car-sales/reports` | The Car Sales module, hidden because the business is not running car sales at the moment. Vehicles, contracts, instalments and their GL postings are all still there |

Car Sales is hidden **apart from its two invoice screens** — Car Invoices
(`/car-sales/contracts`) and Monthly Charges (`/car-sales/service-charges`) are
still sold and still invoiced, so they stayed in the menu under Transactions →
Sales. With no `GROUPS` entry left to read their label and permission from, they
are declared in `EXTRA_ITEMS` instead. Unhide the module by moving the four rows
above back into a Car Sales group in `GROUPS`.

The same applies to anything hidden later: add it to `HIDDEN_ITEMS` with a note,
rather than deleting it.

## The header carries a menu, and the sidebar does not repeat it

Navigation is in two places and each screen is in exactly one of them.
`lib/nav.ts` holds both:

- **`GROUPS`** is the whole model — every screen, its label, the permission that
  opens it, and its place in the global search. Nothing is deleted from here to
  move it between menus.
- **`QUICK_MENU`** is the header bar. An entry names screens by **href**, never
  by label: `href` for a single link (Ledger), `group` for a whole module of
  `GROUPS` by label (Inventory, Payroll / HR), `groups` for two levels
  (Transactions). Labels and permissions are read back out of `GROUPS`, so the
  header cannot show a screen the sidebar does not have, under a name it does not
  use, or to somebody it would not show it to.
- **`inHeaderMenu(href)`** is built from `QUICK_MENU` itself and is the one line
  that decides which menu shows a screen: the sidebar drops whatever the header
  holds. A module the header took entirely (Sales, Purchase, Inventory,
  Payroll / HR) simply disappears from the sidebar.

`headerMenu(access)` resolves the bar once and **both** places draw from it — the
bar on a desktop, and the drawer on a phone, where there is no header and each
button becomes the same entry it is up top. Leave that out and a user whose only
module is in the header has no navigation at all on a phone.

A screen with no `GROUPS` entry goes in `EXTRA_ITEMS` — that is what makes it
resolvable to the header and findable in the search, and it is the only reason a
menu-less screen is reachable by anything but its URL.

## Vouchers: saving posts

Every voucher posts to the GL when it is **saved**. There is no "post" button.
If the voucher type carries an authorisation rule (`acct_approval_rules`),
saving instead holds it for its approvers and the **approval** posts it — the
approver does not press anything either.

- Line-based vouchers (Receipt, Payment, Journal, Contra, Petty Cash) go through
  `gl_submit`, which holds the GL lines and replays them on approval.
- Documents whose posting has side effects — the trade documents (stock) and
  payroll — hold the **document** instead: nothing moves until approval, and the
  approval runs the real routine (`trade_doc_post_now`, `payroll_post_now`) so
  stock and ledger still happen together, exactly once.

Anything new that posts must go through one of those two gates. The internal
`*_post_now` routines are not granted to `authenticated`, so the gate cannot be
walked around.

## The document chain is data, in one place

Which voucher is loaded from which lives in **`workflow_steps`** and nowhere
else. It used to be written down three times — a CASE in
`trade_doc_source_type`, a VALUES list in `workflow_summary`, and hand-laid rows
in the board's JSX — so changing how the business works meant editing three
things and hoping they agreed.

`workflow_source_type()` resolves a step's source **through anything switched
off**, so turning a step off closes the chain up rather than breaking it: switch
off Material Receipt Note and a Purchase Voucher loads straight from the
Purchase Order. `trade_doc_source_type` is a one-line wrapper over it, so the
Load button on every voucher follows the definition. `workflow_step_save`
refuses a circle and a self-reference — `workflow_source_type` is on the path of
every Load in the ERP, so a chain configured into a loop would hang all of them.

The board draws itself from the same table: a step's **depth** is how far along
the chain it sits, and a second child starts a new row at its parent's depth,
which is what puts the purchase branch beside the Sale Order without anybody
positioning it. Nothing about the layout is written down.

## A rule decides whether a voucher needs authorising — nothing else does

No rule matches, the voucher posts on save. That is the default and it is what
`acct_approvals_needed` returns when nothing matches: 0.

A rule (`acct_approval_rules`, edited on `/accounting/rules`) tests any
combination of **voucher type**, **amount from** (0 = every voucher of the
type), **cost centre** (null = any) and **who raised it** (null = anyone). So
"over 100 in CAR SALES INSTALLMENT" and "anything Saad raises" are both rules.
`acct_rule_for()` picks the match, most specific first: naming a person beats
naming a cost centre, which beats an amount alone, and between rules of the
same shape the higher threshold wins.

It did not work this way before, and the old behaviour is the trap to avoid
re-introducing: ticking somebody as an approver for a voucher TYPE held every
voucher of that type, and the amount threshold was consulted **only when
nobody was ticked**. The two controls could not be combined at all.

`acct_approval_rule_approvers` says who may authorise the vouchers a given rule
holds; empty falls back to the type's approvers (`acct_voucher_approvers`), then
to anyone with the authorisation right. `pending_vouchers.rule_id` records which
rule held it, which is how `acct_can_authorize_pending` knows whose approval is
being waited on. An admin may always approve, but **no rule requires an admin**.
Maker-checker and the per-user `acct_authorize_limit` are unchanged and apply on
top.

All three hold paths pass the cost centre: `gl_submit` takes it from the first
line that names one, `trade_doc_post` from the document header, payroll has none.

## Master data is the user's

Nothing creates or edits Product Tree items, accounts or cost centres behind the
user's back. Vouchers **choose** an existing item; they never invent one.

## A customer, agent or supplier is an account in the chart

There is no Customers / Agents / Suppliers screen any more. `/accounting/accounts`
is the one place: New Account asks *what the account is*, and choosing Customer,
B2B Agent or Supplier creates the `parties` record with it. **Party Details** on
the tree edits the rest (code, phone, email, credit limit, credit days, sales
target, active), **Make a Party** gives the record to an account already there,
and Delete takes both halves.

This matters because there are **two** party concepts and about thirty screens
read the wrong one to notice: `parties` is what every picker offers — the visa
group agent, the hotel booking agent and supplier, the Transport Rate Master
agent list (and so the fare chart), the BRN supplier, every trade voucher's
party, Bill Record, Product Rates, the B2B login — while `accounts` is only the
ledger. An account with no `parties` row behind it can be posted to and is
invisible to all of them.

Two rules hold it together, and undoing either splits the master again:

- **One party, one account, and one routine that creates it.** Inserting a
  `parties` row is what raises the ledger account — `trg_party_ensure_ledger`
  fires `ensure_party_account`, and has always done so. `acct_create` therefore
  **adopts** the account the trigger made (moving it to the group the user
  picked and recoding it there) rather than inserting its own. A first cut did
  insert its own, and gave every party made from the tree two accounts, one of
  them dead. `acct_link_party` deletes the spare the trigger raises, after
  checking it carries no postings.
- **A supplier is a Payable, a customer or an agent is a Receivable.** That is
  how `ensure_party_account` finds the account again, so it is checked and
  refused rather than quietly corrected — it decides where the account sits in
  the chart, which is the user's to say.

The name lives on both rows and `acct_party_save` writes both, so the ledger and
the booking screens cannot end up calling somebody different things. Deleting
goes through `acct_delete`, which leans on `delete_party` for the refusals — it
already knows every place a party can be spoken for. `parties.manage` opens the
chart now, and both the menu and the middleware grant it there; a landing that
its own guard bounces is the redirect loop this file warns about below.

## Car money belongs to the customer, not to a bucket

The Car Sales module used to post every receivable to a house control account —
Car Installment Receivable for the sale, Service Charge Receivable for the
monthly charge — so the customer's own account, which exists because **a
customer IS an account in this chart**, stayed at nil. The one screen that
answers "what does this customer owe" answered nothing.

    the car sale        Dr the customer     Cr Vehicle Sales
    the monthly charge  Dr the customer     Cr Monthly Service Charges
    a receipt           Dr Cash / Bank      Cr the customer
    a charge payment    Dr Cash / Bank      Cr the customer

`car_party_account()` resolves it and `car_post_entry` takes an `account_id` on
a line for exactly this reason: every car posting named its account by CODE,
and a customer's code is not one a routine can know. The control accounts are
still in the chart carrying their history; nothing new lands there unless a
contract has no customer at all.

**An advance on a Car Invoice posts nothing.** It is what the invoice says is
due up front. Cash moves when a Car Receipt says it moved — posting both is how
the same 40,000 gets counted twice.

**And the advance is usually received before the invoice exists.** The customer
pays to hold the car weeks before the Car Invoice is raised, so a Car Receipt is
anchored to EITHER a `car_contracts` row or the Sale Order it is an advance
against (`car_receipts.source_doc_id`; a check constraint refuses both null). It
posts the same either side of that line, so the customer simply stands in credit
until the invoice debits them. `car_contract_link_source` — the routine that ties
an invoice to its order — **adopts** those receipts: it fills in `contract_id`,
and their `advance` allocation is already there, so the invoice reads as
advance-paid the moment it exists and the dashboard never asks for it twice.
Nothing is re-posted.

Money coming in has one door: the **Receipt voucher's second tab** (Accounting →
Receipt → Advance on a Sale Order), not a screen of its own. Because it is that
voucher it asks which cash or bank account the money went into —
`car_receipts.cash_account_id`, with the old `method` word (→ 1000 / 1010) still
the fallback for everything posted before it existed.

Two traps that were live in this flow until migration 338, and are the shape to
watch for in any autopost trigger:

- **`car_receipt_save` writes in two moves** — a bare row, then an UPDATE that
  puts the amount on it. The autopost trigger fired `AFTER INSERT` only, so it
  posted a ZERO: `car_post_entry` wrote the entry header, filtered both empty
  lines away, and returned true. That header is keyed (source, reference), so it
  then refused the real posting as a duplicate — for ever. The trigger fires on
  the update too now, and `car_post_receipt` refuses a zero amount; the two
  changes only work together.
- **Deleting a receipt left its journal entry standing**, so the cash book kept
  money no receipt claimed. `car_receipt_delete` unposts.

**A car expense reaches the stock ledger as well as the GL.** It capitalises
into Vehicle Inventory *and* re-values the car's stock receipt
(`car_vehicle_stock_revalue`), because a car is one serialised unit and its
receipt is its landed cost. Without that the same car reads two different
numbers in two ledgers. `stock_apply` refuses a zero quantity — rightly, it
moves goods — so re-valuing is its own routine.

## Three different "invoices"

- `/invoices` — booking invoice, raised automatically, read-only (hidden).
- `/accounting/sales/invoices` — the Sales Invoice (SI-) trade voucher: loaded
  from a Sale Order, has item lines, issues stock, books COGS.
- `/accounting/invoices` — Invoice / Bill, a manual one-off accounting voucher.

## The agent fare chart is one chart, shown twice

An agent signs in and sees their transport selling rates; the office sees the
same chart for any agent on the Rate Master's **Agent Fare Chart** tab — it is
those same effective-dated rate rows resolved into what an agent is quoted, so it
belongs beside them rather than in a menu of its own. "The same" is enforced, not
intended:

- the prices come from `transport_agent_rate()` and `transport_package_price()`
  — the portal reaches them through `b2b_transport_masters()`, the office
  through `transport_agent_rate_chart()`, and neither resolves a price itself;
- both shape the result with `buildRateChart()` (`lib/transportRateChart.ts`)
  and draw it with `components/transport/RateChartTable.tsx`.

Rates are keyed by **party**, not by portal login — `transport_agent_rates.agent_id`
references `parties`, and a login resolves to `coalesce(agent_party_id, id)`. A
null party is not "no chart", it is the **standard** rate an agent with nothing
of their own is quoted. Rates are effective-dated, so a chart is only ever true
*as on* a date. The office picks a **period** rather than a date —
`transport_rate_periods()` turns the rows back into the stretches over which the
resolved chart does not change, by taking every date a rate could change and then
**merging consecutive boundaries whose chart is identical**, so a bulk update
that changes nothing for this agent does not start a period they would click
past. A period ends where the next begins; once its end date has passed it is
`past` and moves into Old rates on its own, with no job to run. The agent's own
portal stays on today.

Package prices are effective-dated too (migration 297): changing one adds a row
with a new `effective_from` and leaves the old as history, so next season can be
entered now. That means a package price change can start a rate period, and
`transport_rate_periods()` takes `transport_package_prices` into its boundaries
and its signature. The agent sees the same periods in their own portal through
`b2b_transport_rate_periods()` / `b2b_transport_rate_chart()` — the token-gated
pair of the office's two. `b2b_transport_masters()` is deliberately left on
today: the booking form calls it and must quote the price in force now.

A package is priced against the same rates. **Transport → Packages → a package**
shows, beside the price being typed, what its legs cost booked individually —
`transport_package_route_total()` sums each leg through `transport_agent_rate()`
too, so the comparison is the real one and the discount is visible while the
number is being decided. It is also what `distribute_package_fares()` already
prorates the package price over, shown before the fact rather than after.

## Staff access is three separate things

A staff user carries three independent controls, all on `profiles`, all with the
same convention: **empty means unrestricted**, and an admin is always exempt.

| Control | Where it lives | What it does |
|---|---|---|
| Modules | `profiles.permissions` (`lib/staffPermissions.ts`) | which modules appear in the menu |
| Screen rights | `profiles.doc_rights` (`lib/docRights.ts`) | per voucher/report: access, create, edit, delete, print |
| Restrictions | `staff_scopes` + `profiles.scope_exclude` | which accounts / products / cost centres / tag areas the user may touch |

Plus a **login window** (`profiles.login_date_*`, `login_time_*`, Saudi time).

Two things follow from this and must not be undone:

- **`is_staff()` carries the login window and the active flag.** It is not a
  "does a profile exist" check any more. Outside the window, or blocked, every
  RLS policy in the database closes with it — the UI is not the only gate.
- **Restrictions are enforced by RLS on the four master tables**, so pickers,
  lists and voucher lines are filtered without each screen remembering to. A
  restriction is a *subtree*: naming a group covers everything under it.

  A **report** honours it by being `security invoker` — then RLS reaches it and
  there is nothing to remember. The 23 read-only reports were flipped for
  exactly that reason; write a new one the same way. The two that ask for
  `staff_scope_ids()` by hand (`acct_ledger`, `trial_balance`) do so only
  because they were written before. `pending_inbox` and `trade_doc_load` stay
  definer on purpose: an approver must see every voucher waiting on them, and
  loading a Sale Order must copy all of its lines.

  A **save** is checked on the way in too, because RLS filters what a picker
  offers but the RPC will accept any id sent to it: `gl_submit` checks its line
  accounts, `trade_doc_save` its line items. Cost centre and tag area are stored
  on vouchers as *text*, not as a reference, so those two restrictions are
  enforced only where they are chosen and cannot be re-checked on save.

Screen rights are enforced in one place for *access* (the middleware, via
`docForPath`) and at the button for the rest. A new voucher screen should take a
`rights` prop from `docRightsFor(access, doc)` the way `TradeVoucher` and
`VoucherEditor` do, and be added to `DOC_TREE`.

Screen rights bite in three places: the middleware (`docForPath`) for *access*,
the button, and the database. A voucher's create/edit/delete goes through
`staff_require_doc` / `staff_require_journal_right` / `staff_require_trade_right`
inside the routine that is the only way into that screen. `edit_others` and
`edit_authorized` are read off `created_by` and off a `pending_vouchers` row
pointing at the document.

An **engine** is never gated — `gl_post`, `party_invoice`, `stock_apply` are
called by the Visa, Hotel and Car modules on a user's behalf, and a data-entry
right must not block them. When a shared engine also needs a typed-by-hand
door, the door is a separate wrapper that carries the right:
`invoice_bill_save` → `party_invoice`. Same for `staff_doc_key`: a source it
doesn't recognise returns null, meaning "not a rights-managed screen", which is
allowed on purpose.

## Handing out access is the one thing "empty" does not grant

Everywhere else an empty setting means unrestricted. The six `users.*`
permissions are read by **`staff_perm_strict()`**, which requires the key to be
explicitly ticked — otherwise a fresh account with nothing set could administer
everybody. `users.manage_roles` is what lets someone who is not an admin set
another user's modules, rights, restrictions and login window.

A delegated user manager still cannot escalate: `staff_admin_guard` refuses
their own row, refuses an admin's row, and `create_staff_user_v2` refuses to
mint an admin unless the caller is one. `staffPermStrict()` mirrors the strict
read client-side, so the Users screens never offer a button the RPC behind it
will refuse.

Administering somebody else reads **whole** trees: `staff_scope_masters()`
ignores the caller's own restrictions, because the Restrict tab saves back what
it renders and a partial list would be written as a complete one.

Nobody writes their own `profiles` row at all — `profiles_self_update` is gone,
so even a name change is an admin edit. The trigger that blocks a non-admin
from changing their own permissions, rights, window, active flag or authorise
limit stays as a second line of defence.


There is one more strict key outside `users.*`: **`visa.allocate_issued`**. An
issued visa freezes a group — `guard_group_update` turns away any non-admin
edit. Two exceptions are open to every staff user, because they are things that
happen *after* issuance: arrival service / invoice tracking, and
`package_status` (the package update itself). Re-allocating the **hotel** on a
sold group is not one of them: `brn_status`, `covered_from` and `covered_to`
need `visa.allocate_issued`, read through `staff_perm_strict()`, and every such
change is written to the audit log as `group_issued_coverage_edit`.
## One dashboard, and cards are opt-in

Every card lives on `/dashboard` and is registered once in `lib/dashboardCards.ts`
— add it there and it appears both on the dashboard and in the per-user picker.
All the figures come from a single `dashboard_metrics()` call, which is
`security invoker` so a restricted user's dashboard is built from only the
accounts and products they may see.

**A card is only worth what its number is, so check the number, not the code.**
Reading a card's SQL tells you it runs; it does not tell you it is right. Every
dashboard figure was checked against an independent query in September 2026 and
one was badly wrong: Receivables and Payables read `open_items`, the invoice and
bill subsystem, so the business looked owed 47,505 when its receivable accounts
held 199,133.48 — nineteen accounts carried a balance and eight were counted. A
car sale, a visa invoice, a transport charge and a hotel booking all debit the
customer's account directly and make no open item. **Money questions read the
ledger.** Only overdue still comes from `open_items`, because a due date exists
nowhere else, and the card says it is a floor.

Two other traps that sweep caught, both in Car Customer Balances: summing a
PARENT's column across a join to its children multiplies it by the child count
(a 12-instalment contract counted its own value twelve times), and buckets shown
side by side must be disjoint or the reader adds them and double-counts.

Card access **reverses** the convention used everywhere else: an empty
`profiles.dashboard_cards` grants **nothing**. Only an admin sees every card;
everyone else sees exactly what an admin ticked. A dashboard puts the whole
company's money on one screen, so it is opt-in rather than opt-out.

There is no module dashboard any more. `/accounting`, `/car-sales`,
`/hotels/dashboard`, `/inventory` and `/transport` forward to `/dashboard` —
the routes stay so links and bookmarks keep working, but every card they used to
carry is in the register. A new card goes there, never onto a module screen.

A card's buckets must not overlap, and a label must mean what it says. Car
Customer Balances got both wrong. **Due** and **Overdue** each counted the same
instalment, and **Outstanding** was the instalment schedule rather than what the
customer owes. All three are money questions, so:

- **Due** — its date has ARRIVED and its month has not ended. Not "dated this
  month": an instalment dated the 20th is not due on the 1st.
- **Overdue** — the month it was due in has ended. Not merely past its date;
  nobody chases a customer on the 9th for something dated the 8th.
- **Total** — Due + Overdue, which is safe to add only because they are disjoint.
- **Balance** — the customers' LEDGER balance, summed off their accounts. The
  instalment schedule is not it: an advance is on the invoice but not in the
  schedule, so CI-000003 scheduled 82,000 against a real balance of 123,000.

Two traps found in that one card. Contract-level figures (`sale_value`,
`advance`) were summed across the join to `car_installments`, so a 12-instalment
contract counted its own total twelve times — take those from `car_contracts`
alone. And the service-charge card is NOT the same shape: its "this month" is
what was BILLED, not what is owed, so it needs none of this.

Two things follow. The landing lists in `lib/staffSession.ts` and
`lib/supabase/middleware.ts` must not point at a forwarding route: a user
without `dashboard.view` would be sent to their landing, forwarded back to
`/dashboard`, and bounce forever. And the figures come from **two** calls —
`dashboard_metrics()` for the money and trade cards, `dashboard_module_metrics()`
for the ones absorbed from the module dashboards (Umrah, transport, hotels).

## `revoke ... from anon` is not a gate; `revoke ... from public` is

Postgres grants EXECUTE to **PUBLIC** on every new function, and `anon` is a
member of PUBLIC. So the `revoke all on function ... from anon` line these
migrations write after a staff-only routine takes away a grant that was never
the one letting anon in — measured as the anon role, `dashboard_metrics()` ran
and `mark_package_updated_manual()` reached its own body.

Nothing leaked, because the real gate is inside each routine (`is_staff()`, or a
portal token) and the invoker ones come back empty with no company for RLS to
scope by. But a `security definer` routine an unauthenticated caller can enter is
one gate away from trouble. Write **`revoke all on function ... from public,
anon`** then `grant execute ... to authenticated`.

Migrations 292 and 293 swept the whole schema. **78 functions are anon-callable
now, down from 382**, and every one of them is anon by design: the `b2b_*`
family, the portal logins and sessions, the two public voucher links, the five
cron endpoints (which run with no session and their own `CRON_SECRET`), and the
three push-dispatch routines gated by `p_secret`. That list lives in migration
293 and is derived from the code — every `rpc()` reachable without a Supabase
session — not from a name pattern.

293 also found the thing the PUBLIC default was hiding. **Fourteen internal
engines had a real, hand-written `grant execute ... to anon`** — including the
`*_post_now` routines that are deliberately not granted to `authenticated` so
the post-on-save gate cannot be walked around. Three of them had no gate of
their own at all: measured as anon, `stock_apply` reached a NOT NULL violation
mid-insert, `acct_hold_document` reached a foreign-key violation while inserting
a pending voucher, and `car_post_contract` ran to completion. The anon key ships
in the browser bundle, so anon means anybody. They are closed, and nothing was
granted to `authenticated` to compensate — the property still holds.

**A new staff-only routine needs no grant at all** beyond `grant execute ... to
authenticated`. **An internal engine, however, needs an explicit REVOKE — and
naming `public, anon` is not enough.** "Leaving it ungranted is what makes it
internal" was wrong, and migration 372's own post-condition is what caught it:
a brand-new function came out callable by `authenticated`.

The reason is `ALTER DEFAULT PRIVILEGES`. This project carries four entries in
`pg_default_acl` for functions, from `postgres` and from `supabase_admin`, each
granting EXECUTE to **anon, authenticated and service_role**. So a new function
is born already granted to anon AND authenticated — explicitly, by name, not
through PUBLIC. `revoke ... from public, anon` closes anon and leaves every
logged-in user holding EXECUTE.

So an internal engine needs:

    revoke all on function ... from public, anon, authenticated;

and the only way to know it worked is to measure it:

    select p.proname,
           has_function_privilege('authenticated', p.oid, 'execute') as auth,
           has_function_privilege('anon', p.oid, 'execute')          as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '...';

The engines that matter are closed and were verified in September 2026:
`trade_doc_post_now`, `payroll_post_now`, `stock_apply`, `acct_hold_document`,
`car_post_contract`, `car_post_vehicle` and `car_post_receipt` are all shut to
anon and to authenticated, so the post-on-save gate cannot be walked around.

**Three are still open to any logged-in user**, and they are worth a decision
rather than a silent change: `gl_post` (both overloads), `car_post_entry` and
`party_invoice`. This file calls `gl_post` and `party_invoice` engines that are
"never gated" because the Visa, Hotel and Car modules call them on a user's
behalf — but those callers are `security definer` routines, which execute as
the owner and therefore do **not** need the caller's grant. The grant is
unnecessary, and while it stands, a logged-in user can post a journal entry
directly and step around the `acct_approval_rules` gate that `gl_submit`
enforces.

**That count drifts, so re-measure rather than trust it.** It was 100 at the
September 2026 sweep, not 78 — twenty-two routines had picked up the PUBLIC
default since 293. Most are harmless (a trigger function cannot be called
directly however it is granted) but five were not:

    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
       and p.prorettype <> 'trigger'::regtype;

`car_monthly_run`, `refresh_brn_availability` and the three
`generate_*_reminders` **were anon-callable with no gate of their own** —
CRON_SECRET is checked in the Next.js route, but the route calls the database as
anon (there is no service-role key in this project), so the RPC was reachable
directly with the key that ships in the browser bundle and the route could be
stepped around. `car_monthly_run` generates monthly charges and posts journals.

Migration 333 gave each of the five a `p_secret` argument, checked against
`cron_config.secret`, exactly as `push_prune` checks `push_config`. **They are
still anon-callable and must be** — the scheduler has no session — so the secret
is the whole gate. It lives in two places and has to match: `cron_config.secret`
in the database, and `CRON_SECRET` in the deployment environment, which the
route passes through to the routine. Change one without the other and the jobs
stop rather than run unprotected, which is the right way round to fail.

A new scheduled job goes the same way: `p_secret` first, checked before anything
else, and the route hands `process.env.CRON_SECRET` to it.

## A select() without a bound is a bug waiting for the 1001st row

PostgREST caps a response at **1000 rows and says nothing** — no error, just a
short array. Any screen that loads a whole table and does its own arithmetic is
therefore right only until that table passes a thousand rows, and then quietly
starts lying.

This is not hypothetical: `brn_consumption` reached 1027 rows and the Daily
Calendar began showing a BRN's full 12 beds as available, because the row
consuming 7 of them was number 1010. The group's own badge stayed correct
because `brn_availability` counts in SQL — which is exactly how the two screens
came to disagree.

Read a whole table with **`fetchAllRows`** (`lib/supabase/fetchAll.ts`), which
pages until a short page comes back. It needs a **total order** on the query —
`.order("id")` — or the page boundaries can move between requests and rows are
skipped or repeated. `.eq()`/`.in()` bounds the *filter*, not the row count: many
groups with a few allocations each still adds up past a thousand.

Better still, count in SQL and return the answer, the way the reports do.

## The clock is Saudi, on both sides

The business runs on Asia/Riyadh (UTC+3, no daylight saving), so both halves of
the app answer in it. Neither half is optional: the browser deciding what "today"
is and the database deciding it separately is how a voucher gets saved with
tomorrow's number under yesterday's date.

- **The database** is set on the roles (migration 311), not on a connection, so
  `current_date`, `now()::date` and `localtimestamp` are Saudi in every session —
  PostgREST, the cron endpoints, psql. Before this, for the first three hours of
  every Saudi day they were all still on yesterday, which also opened and closed
  the login window (`is_staff()`) three hours late.
- **The browser** goes through `lib/saudiTime.ts`. `todaySA()` is what a date
  input is defaulted to — never `new Date().toISOString().slice(0, 10)`, which is
  the UTC day, and never `getFullYear()/getMonth()`, which is the viewer's.
  `addDaysSA`, `monthStartSA` and `yearSA` are the same idea for a window.

Nothing stored moved: a `timestamptz` is an absolute instant and only its
rendering changed, a `date` is a wall-clock day and was not converted.

**Displaying** keeps the two apart, and that distinction is the whole of
`lib/format.ts`. A `date` column (or a naive timestamp) is read **literally** —
putting it through `new Date()` lets the viewer's zone decide which day it is. A
`timestamptz` is an instant, so `dateStr`, `fmtTime12` and `dateTimeStr` render
it **in Riyadh**. `new Date(x).toLocaleString()` does neither and is why the
audit log, the outbox and the notification bell used to read differently on a
phone abroad; use `dateTimeStr` instead.

Date *arithmetic* on a wall-clock string stays UTC-anchored (`new Date(d +
"T00:00:00Z")`, `setUTCDate`, `toISOString().slice(0, 10)`) — `lib/brn.ts`,
`lib/planning.ts` and the schedule navigators do it that way on purpose. That is
correct and is not the same bug: it never asks what time it is.

## A trip in the wrong status is an alert, not a notification

A trip's status only moves when somebody presses Start, Picked Up and Complete,
so a forgotten press leaves a trip open for days and a driver "on the road" who
is at home (migration 374 cleaned up two of those). `transport_trip_alerts()`
(migration 375) is the one list of trips sitting in the wrong status, under two
rules measured from the trip's own timetable (`trip_date + trip_time`, plus the
route's driving minutes):

- **Pickup not recorded** — 3 hours past the scheduled pickup and the status is
  still pending, assigned, outsourced or driver-en-route.
- **Not completed** — a started trip still open 1 hour after pickup + driving
  time.

Each trip appears once. It is drawn in three places from that one source, and
only for users holding `transport.operations` or `transport.driver_assign`
(`TRIP_ALERT_PERMS` in `lib/tripAlerts.ts` — a plain module, because the
dashboard page is a server component and anything a `"use client"` file
exports reaches a server component as a client *reference*: calling `.some()`
on one threw and took the dashboard down for everybody): the red pill beside the bell (`TripAlertBadge`, off
`transport_trip_alert_summary()`), the banner on the dashboard and on the
operations board (`TripAlerts`, with Picked Up / Complete buttons that call the
same routines the board does), and an Alerts cell on the Transport card. It is
**not** a notification: nothing is sent, nothing is stored, it is on the screen
while the trip is wrong and gone the moment the right button is pressed. Both
routines are `security invoker`, so a restricted user is alerted only about
trips they may see.

## A Jeddah Airport pickup has a 30-minute grace

`transport_driver_reason` — the one routine behind manual assign
(`transport_assign_check`, `transport_assign_trip`) and auto-assign, so a
change here reaches every path a driver is checked against a trip — treats a
driver as not late for a Jeddah Airport pickup until **30 minutes past the
scheduled time**. The passenger is still clearing immigration and collecting
luggage, which the business allows 45 minutes to an hour for, so a driver
reaching the airport within that window has not actually missed anything.

The repositioning check (does the gap between a driver's last trip and this
one give him enough time to get there, per the Route Master) widens what
counts as "enough" by 30 minutes when the trip being driven **into** starts at
Jeddah Airport (`arr_from[i] ilike '%airport%' and ilike '%jeddah%'`) — capped
at 30, not open-ended. The error message still reports the true schedule gap,
not the padded one, so a driver who is genuinely short is told the real
number. This does **not** touch `transport_reposition_conflict` (the >100 km
Force-Assign approval rule) or the 12-hour work-time count — those ask
different questions, and only "is the driver late for this pickup" is
softened.

A duty window with no 10-hour rest in it chains every trip together, so a
gap that was never a problem on its own can surface the moment a new trip is
assigned onto the end of the chain — migration 388 was written against
exactly that: a driver's own earlier 75-minute gap into a Jeddah Airport
pickup, needing 90 by the Route Master, only turned into a hard error once a
third trip pulled his whole day into one window with no rest break in it.

## The module invoices are vouchers

Visa, Transport and Hotel invoices are **trade documents** (`visa_invoice`,
`transport_invoice`, `hotel_invoice`; migration 377), shaped exactly like the
Air Ticket Invoice: a customer, a supplier, the gross on the line and the
supplier's cost beside it, four legs and no stock. The module **raises** one —
a visa group created, a trip completed, a hotel booking vendor-confirmed —
when the matching rule on Accounting → Automation is switched on. **Whether it
is on is the business's decision, not a migration's**: 377 turned the three
rules on without being asked and 378 turned them off again. From then on it is a voucher
like any other on Sales Invoice: opened by number, edited and re-posted,
printed, deleted, or typed from scratch for something the module did not raise.

Three things hold it together:

- **`trade_doc_raise` is the modules' door**, not `trade_doc_save`. The
  modules fire from triggers and from the driver portal, where there is no
  staff session for `trade_doc_save` to check, and the ledger is written by
  `gl_post_internal` for the same reason — `gl_post` refuses a caller with no
  session, and the first attempt at 377 found that out on a trip completed
  from the portal. Both are internal, granted to no role; the approval rules
  still apply (`trade_doc_raise` runs the same gate as `trade_doc_post`).
- **One document per source.** The module writes `meta.source_kind` /
  `meta.source_id`, a unique index refuses a second document for the same
  source, and `trade_doc_save` carries the two keys through an edit. Raising
  again returns the existing document.
- **The module row follows its voucher.** `trg_trade_doc_module_source_sync`
  keeps `transport_trips.gl_entry` and `hotel_purchase_bookings.gl_posted_at`
  in step with the document's `gl_entry` on unpost, re-post and delete.

The supplier may be a **party** (`meta.supplier_id`: a hotel vendor, a
consolidator) or an **account** (`meta.supplier_account_id`: a visa company's
supplier ledger, a transport vendor's). The posting takes whichever is filled,
and a cost owed to nobody is refused. `meta.cash_by_supplier` is the transport
vendor collecting from the passenger on our behalf: Dr the vendor, Cr the agent.

The old per-module posters (`visa_invoices` with its own editor, the
`party_invoice` pair for hotels, the bare `gl_transport` entry) are history.
`visa_invoices` and `/accounting/visa-invoices/[id]` remain only for rows raised
before 377.

## Monthly Charges is a voucher, reached from one place

One journal entry a month (migration 350) is drawn as a voucher whose document
is the **month**: `car_charges_month_load` draws it (the cars charged that
month, the rule's figure beside each so a hand-corrected amount is visibly a
correction, and the cars on a contract that are not on it yet),
`car_charges_month_save` is the one door — it upserts the month's
`car_service_charges` rows, refuses to remove a charge something has been paid
against, and rebuilds the month's `car_scharge_month` entry from what is on the
screen. Generate fills the month from `car_charge_for_month`.

It lives on **Sales Invoice → Monthly Charges** and nowhere else. The Sales
Invoice screen opens for `carsales.charges` as well as `accounting.view`,
showing only the tabs the user may see, so a charges-only user is not stranded;
`/car-sales/service-charges` forwards there. The register (every month at once)
sits under the voucher.

## Voucher numbering is the user's

Every number the ERP issues comes from `doc_sequences` (prefix, digits, next
number) through `next_doc_number()`, and **Settings → Company → Voucher
Numbering** is where the business sets them (migration 381):
`doc_sequences_list()` draws the screen, `doc_sequence_save()` is the one door,
and the next number moves **forward only** — a number already issued is never
issued again. The screen's names come from `lib/docSeries.ts`; a series the
database has that the catalogue does not name still shows, under its key.

A trade voucher has two numbers — the document's (PV-00003) and its ledger
entry's (JPV-00004) — for no accounting reason, only because the ledger numbers
every entry from a series of its own. The setting `ledger_uses_doc_no`
(`erp_settings`, on the same screen) makes the entry carry the document's own
number; `gl_post_internal` reads it for the trade documents and
`car_post_entry` for the car postings (a reference shaped like a document
number — CI-, RCP-, CAR- — becomes the entry number; migration 384). It is ON.
The month voucher has its own series, `car_scharge_month` (MSC-). The
accounting vouchers (Receipt, Payment, Journal, Contra, Petty Cash) ARE the
entry and have only the one number.

Two numbers used to come from raw Postgres sequences with the prefix written
into the routine — the Car Invoice (`CI-`) and the Car Receipt (`RCP-`). 381
replaced that one line in each with `next_doc_number()` and seeded the row from
the highest number issued. The vehicle (`CAR-`), hotel (`HTL-`) and transport
(`TRP-`) booking numbers still come from sequences: they are not vouchers.

## Every invoice is a bill the receipt can adjust against

The Receipt, Payment and Journal vouchers carry a bill-wise adjustment
(`VoucherEditor`, `party_outstanding`, `apply_billwise_allocations`): put an
amount on a party line and the popup lists that party's open bills. It reads
`open_items`, and until migration 385 only the Bill Record (`party_invoice`)
ever wrote one — the trade vouchers, the Car Invoice and the Monthly Charges
posted the party's line and wrote no bill, so the popup had nothing to offer
and never appeared.

**Every posting that debits a customer or credits a supplier raises the bill**
through `open_item_raise`: `trade_doc_post_now` for the Sales Invoice, the four
service invoices (customer side, and the supplier's cost leg), the Purchase
Voucher and the two returns (as credit notes); `car_post_entry` for a car sale
and for each customer's line of a Monthly Charges voucher. A new posting path
that touches a party account must do the same, or its receipts cannot be
adjusted.

**And the bill goes with its voucher.** `trg_journal_entry_release_open_items`
on `journal_entries` (before delete, and before an update of `status` to
`void`) removes an entry's bills when the entry is unposted, refuses if a
receipt has been adjusted against them, and gives back what a deleted receipt
had settled — one rule for every unpost path (`trade_doc_unpost`,
`car_contract_unpost`, `car_charges_month_save`, a voided voucher) rather than
one per routine. The void half matters: **deleting an accounting voucher does
not delete its row** — `gl_voucher_void` marks it `void` and keeps it — and
385's delete-only trigger left a voided receipt's allocation standing on the
bill (386). `acct_voucher_guard` refuses to EDIT a voucher that carries
allocations, and no longer refuses to delete one, because the release handles
that.

**A car sale is billed the way it is owed** (387): the advance — whatever the
schedule does not carry — as `CI-000005 advance`, due on the invoice's advance
date, and one bill per instalment, `CI-000005/1` … `/12`, each due on its own
date. `car_contract_bills_raise` is the one routine; the posting and the
backfill both use it. One bill of 123,000 due on the first instalment's date
was the trap: the popup offered the whole invoice, and the ageing report put
all of it in 0–30 when 8,583 was due. A **Car Receipt** (RCP-) settles these
bills through the allocations it already carries (`car_receipt_settle_bills`:
the instalment or advance it names, then FIFO over that contract's bills), when
it posts, when an invoice adopts its order's advance receipts, and when a
contract re-posts. A contract re-posts on every edit, so the release routine
lets a *car receipt's* allocations go silently — they are re-settled — and
refuses only for a receipt typed by hand, which nothing can re-settle.

**Every bill has a due date**, because the popup and the ageing report show
it: a trade voucher's own; a month of charges on the **first of the next
month** (September's charges are due 1 October); otherwise the bill date plus
the party's credit days, which is what `parties.credit_days` is for.

The ageing report (`ar_ap_aging`) ages by due date and has a **Not due**
bucket for what is billed but not yet due — most of a car sale, a bill inside
its credit days. It agrees with the ledger only while every party posting
raises a bill and every receipt is adjusted. A receipt saved **on account**
(nothing picked in the popup) reduces the ledger and not the bills, and the
report then ages more than is owed — the dashboard's Receivables card reads
the ledger for exactly that reason.

A plpgsql trap 387's rehearsal caught: `car_post_entry` declared a loop
variable `l` beside the `l` alias of its `jsonb_array_elements`, and plpgsql
only complains ("column reference l is ambiguous") when the statement runs —
every car posting since 385 would have failed. A rehearsal that exercises the
routine is the only thing that catches it; a `create function` that succeeds
proves nothing.

## A cost is not an expense

The subtype **`COGS`** on an expense-type account (on the account editor) is
what says it is cost of sales. The P&L shows Income, **Cost of Sales**, a
**Gross Profit**, then Expenses; the Expenses card and the P&L card leave COGS
out of "expense"; `trial_balance` returns `subtype` for exactly this. 5000 and
5100 were raised by the ERP with no subtype and are COGS now (387); anything
else is the user's to classify. **Purchase vs Sale** counts every posted sale
document — Sales Invoice, the four service invoices and the Car Invoice, which
is not a trade document — and its margin is sale less cost of sales off the
ledger, not sale less what was bought.

## Transport Costing & Pricing is a separate module, built entirely from data the ERP already has

`/transport/costing` (migrations 389–390) answers "what does this trip actually
cost, and what should we charge for it" from the same vehicles, drivers,
routes, trips and expenses every other Transport screen uses — nothing about
the existing Transport module changed to build it, and it creates no
duplicate vehicle, route, driver or expense record.

**What "owned" means was already in the schema, not invented for this.**
Every completed trip — outsourced included — carries a `vehicle_id`, because
that column names the CATEGORY of vehicle the booking needed, not who
actually drove it. `transport_vehicle_cost_model()` — the one routine
everything else in the module calls, so fuel, driver and overhead cost are
never re-derived twice — only ever reads a vehicle's own operating history
off `is_outsourced = false` completed trips. An outsourced trip's cost is
its `vendor_cost`, full stop; it never touches that vehicle's fuel, driver,
depreciation or overhead lines, matching how Route Profitability blends an
owned leg's own cost/KM against an outsourced leg's real vendor cost rather
than pretending one model fits both.

**A driver cost is a personal recurring cost, not whoever is named on an
expense row.** `transport_expenses` already had `vehicle_id` and `driver_id`,
so this reuses it rather than adding a driver-expense table — but a row
carrying BOTH is a vehicle cost that happens to note who incurred it (a
driver filling the tank), not a salary or accommodation charge, and 390 is
the trap to avoid re-introducing: summing every expense tagged to a vehicle's
CURRENT driver, instead of only the driver-only rows (no `vehicle_id`), let a
fuel receipt for one vehicle silently inflate a different vehicle's driver
line because the same person happened to be tagged on both. The driver
bucket reads only rows with no vehicle attached.

**Fleet overhead has exactly one source**: `transport_expenses` rows tagged
to neither a vehicle nor a driver, category `admin_overhead` — nothing
outside Transport is ever swept in, which is the module's own explicit
promise to itself. `transport_vehicle_overhead_share()` splits that pool five
ways (equal / by KM / by revenue / by active days / manual, with "by KM" and
"by vehicle utilization" being the same measure under two names, not two
different numbers) and is the only place any of them are computed.

**Nothing is invented where the history is not there.** Fuel, oil and tyre
cost each prefer actual expense ÷ actual KM over an assumed rate, falling
back to a configured lifecycle model (cost ÷ life-KM, set per vehicle on the
module's own Vehicle Cost Profile tab — the Vehicles master screen is
untouched) and finally to `insufficient_data`, shown as that in the
breakdown rather than a fabricated zero-looking-like-a-real-number. A
`confidence` score (HIGH ≥ 12 months of that vehicle's own history, MEDIUM
3–11, LOW under 3) is measured from actual data span, bounded by the period
asked for — not the size of the window requested — so a 12-month query
against six weeks of real history reads LOW, honestly. `transport_expenses`
gained new free-text categories for this (tyre, oil_service, insurance,
registration, nusuk, driver_salary/accommodation/iqama/insurance,
admin_overhead) alongside the original six, unchanged, on the same Expenses
screen.

**Margin and markup are never the same number.** `transport_costing_price_for`
computes margin as `cost / (1 - m/100)` and markup as `cost * (1 + m/100)`,
selectable per company (`erp_settings transport_costing_margin_method`).
Empty-return cost is read from history, not assumed for every one-way trip:
`transport_route_return_probability()` counts a route leg as a paid return
only when the SAME booking has a completed return leg within 24 hours, and
`transport_costing_expected_km()` uses that percentage — or a manual
override — to add the probability-weighted return distance, never doubling a
trip that is known to come back with a fare.

A **Costing Snapshot** freezes the numbers a calculation actually used,
because the ERP data behind it moves.

## The voucher is typed through

`lib/focusNext.ts`: picking an account moves the cursor to the amount, and
Enter moves to the next field the way Tab does (`enterMovesOn` on the editors'
root), except where the field handles Enter itself — a datalist input with no
match yet, a search dropdown (`data-searchselect`), anything `data-enter-keep`.
Line vouchers start with one line and grow as the last line is filled; **+
Line** sits beside the grid, not beside Save.

Every accounting voucher can be in a **foreign currency**: amounts are typed in
it, the rate comes from the currency master (`currencies.rate_to_base`) and can
be overtyped, the entry is posted in SAR, and `gl_voucher_stamp_fx` writes the
currency and rate on it (the Journal's `gl_journal_fx` did that already). The
bill-wise popup works in SAR, so `lineAmt` is the base amount.
