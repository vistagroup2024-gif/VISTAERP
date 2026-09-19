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

## A report explains itself through its numbers, not a paragraph above them

Every report screen (`components/reports/*`, and the same shapes hand-rolled
before `DataTable` existed) follows one visual system, established after a
round of user feedback found the ERP's report screens carrying dashboard-card
prose and mismatched greys. **This is the standing convention — apply it to a
new report by default, don't re-derive it:**

- **No subtitle.** `PageHeader`'s `subtitle` and the old `SectionHeader`
  `subtitle` prop both carried "Grouped the same way the chart of accounts
  groups them," "Due is billed, arrived, and its month has not ended…" — a
  paragraph explaining how the report works, sitting above a grid whose own
  column headers already say that. `SectionHeader` no longer even takes a
  subtitle prop — title only. A `PageHeader` that needs a date range states it
  in the **title** (`Trial Balance — 01-01-2026 to 30-06-2026`), the way
  Ageing Detail's own title already did. The one thing `PageHeader.subtitle`
  is still for is literal identifying data a title can't hold — a customer's
  phone/email on their detail page, a document's own number — never prose
  about method.
- **Dark green up top, light green for the grid.** `SectionHeader` and
  `ReportKpi`'s header strip are both solid `bg-brand-700` with white text —
  the same green family as the rest of the ERP's brand color, deliberately
  darker than the grid beneath them. `DataTable`'s `<thead>` (and every
  hand-rolled report table's) is `bg-brand-50 text-brand-800` — light, so the
  two never compete and the eye reads top-to-bottom: section title, KPI row,
  then the grid. Neither is slate/grey any more.
- **Grid lines.** A report table reads as a spreadsheet: `border-collapse`
  with `border border-slate-200` on every cell — `DataTable` carries this
  directly, and any other report's own `<table>` gets there with one class,
  `report-grid` (`app/globals.css`), rather than bordering every cell by
  hand. This is a report-only convention — the shared `.th`/`.td` classes
  most other grids in the ERP use (voucher lines, master lists) are
  unchanged, on purpose: this file's whole "no unnecessary text" and
  "spreadsheet grid" push is about report screens, not the entire UI.

`/dashboard`'s own cards (`DashboardCard.tsx`) carry the same dark-green
header now too — asked for separately, once the report screens had already
moved, so the two never drift back apart into "a colourful dashboard and a
plain report" the way `ReportKpi`'s own doc comment already warned against.

Two more additions to the same standing convention:

- **Zebra rows, but never a CSS rule.** `DataTable`'s two row renderers
  (`FlatBody`, `GroupedBody`'s plain rows) alternate `bg-slate-50/70` on odd
  indices, and any hand-rolled `report-grid` table does the same by hand,
  keyed off its own `.map((r, i) => …)` index. This is deliberately NOT a
  `tbody tr:nth-child(even)` rule: a row's own state color — `bg-red-50/50`
  for a low-stock or short row, a Due/Overdue amber or red text — is set
  directly on that row or cell and has to keep winning, and a compound
  `.report-grid tbody tr:nth-child(even)` selector would out-specificity a
  plain utility class and fight it. Index-based JS stripe has no
  specificity to win.
- **A column the viewer can drag narrower or wider — from the border, not
  an icon.** The first cut used CSS `resize: horizontal` on the header
  label, and it was wrong: the browser draws its own small grip icon in one
  corner of the cell, and only that corner is the actual drag hotspot —
  not "grab the line between two columns" the way a spreadsheet works.
  `ColumnResizer` (`components/reports/ColumnResizer.tsx`) replaced it: a
  client component mounted once in the ERP shell (`app/(erp)/layout.tsx`,
  inside the embed branch every tab's iframe actually renders), it finds
  every `table.report-grid thead th` on the page — MutationObserver-driven,
  since most reports render their table only after an async fetch, well
  after mount — and attaches a real, invisible drag strip over each leaf
  column's right border (a colSpan group-header cell is skipped; there's no
  single border to grab). `DataTable`'s own `<table>` carries the
  `report-grid` class for exactly this reason, so it's reached the same
  way as every hand-rolled one. `.col-resize` (`app/globals.css`) is now
  styling only — wraps a `<th>`'s label in a single-line ellipsis — and
  every report's header already wraps its label in it, unchanged.

Both are rolled out ERP-wide now: `DataTable` (which covers most reports)
and every hand-rolled `report-grid` table — Car Customer Ageing Summary,
A/R & A/P's QuickList and Ageing Detail grids, Trial Balance, Sales
Report's Monthwise pivot, P&L's Cost Center Profit & Loss panel, Advance
vs Receipt, both Orders Report tables (and their nested line-item tables),
the customer detail ledger, Transport Reports' shared table helper, the
Visa Ledger, and the Car Sales / Inventory / Hotels report screens. A new
hand-rolled report table follows the same two patterns from the start
rather than re-deriving a different approach.

Car Customer Balances' Monthly Due / Monthly Receipts headers use a third
variant, `.col-resize-wrap` — same drag handle, but the label wraps onto
two lines instead of truncating, so a long header ("2nd Last Month Due")
over a narrow numeric column can sit narrower without an ellipsis eating
it. Use `.col-resize-wrap` only where a header's own text is unusually
long relative to what's below it; a short label (Name, Date, Amount)
always gets plain `.col-resize`.

## A report filter is multi-select unless the options are mutually exclusive

Sales Report's own Value/Qty toggle used to be a single-select radio (pick
one) even though both are just independent columns that can be shown at
once — the same shape as Purchase/Sales Orders Report's Pending/History/All
three-tab split (All was only ever "both of the other two, so give it its
own button") and the Air Ticket Bookings worklist's five exclusive status
tabs (Held/Issued/Expired/Cancelled/All, when a user reviewing Held often
wants Expired alongside it). None of those are a real either/or.

**The test**: if the options are independent criteria whose selections can
be shown together — extra columns, a wider status filter, anything a plain
union of "show me A, or B, or both" answers — it's multi-select, a toggled
button group over a `Set`, styled `bg-brand text-white` on / `bg-slate-100
text-slate-600` off (`TransactionsFilters.tsx`'s `types: Set<string>` is the
original of this shape; `LedgerReport.tsx`'s `columns: ColKey[]` column
picker is the same idea for optional columns). Keep at least one option
selected — a toggle that would empty the set re-adds itself instead of
turning off, the way Purchase/Sales Orders Report's status toggle does.

**Single-select stays single-select where the options are not additive**: a
pivot dimension (CC Group vs Cost Centre vs Customer vs Product — the row
grouping, not a column that can be turned on beside another), a date window
(7/30/60 days — nested, not combinable), a calculation mode that changes
what's computed rather than what's shown, or a tab that swaps the whole
screen's layout (Ageing vs Monthly on Car Sales Outstanding). If unsure,
ask: does selecting two of these ever mean something a user would want to
see at once? If yes, multi-select; if the options describe mutually
exclusive states of the same thing, leave it a single choice.

**A pivot dimension can still be multi-select if the dimensions are
levels of the SAME hierarchy rather than alternate ones.** P&L Filteration's
CC Group / Cost Center / Month wise looked like the exclusive-pivot case
above and was built as one at first — wrong, because CC Group and Month
wise are two levels of one drill (Group -> Month) a user genuinely wants
together, not two different things to view instead of each other. The
working split: CC Group and Cost Center pick the row hierarchy (Group only,
leaf only, or Group -> leaf, toggled independently) and Month wise is
additive on top of whichever of those is active; Year wise (a flat
This-Period-vs-Last-Year comparison) and Tag Area (an alternate SOURCE to
Cost Centre, not another level of it) are the two genuinely exclusive
choices in the same button row, so picking either clears the others per the
same "keep at least one selected" rule. A mixed row like this needs the
mutual-exclusion worked out per option, not applied as "pivot dimension,
therefore single-select" to the whole row.

## A report's month column reads "Aug-26", never the RPC's raw "2026-08"

Every monthly breakdown in the schema returns its key as `to_char(d,
'YYYY-MM')` — that's a sort key, not a label, and was leaking straight onto
screen (a chart axis, a pivot header, a table's own Month column) across
Sales Report, P&L, Cost Centre Costing, Purchase Report, Drawings,
Purchase vs Sale and Transport Reports. `monthShort()` (`lib/format.ts`) is
the one formatter — "Aug-26" — every one of those now calls before a month
value reaches JSX; a new report does the same rather than rendering the raw
key or inventing its own format.

## `DataGroup.values` — a group row that is itself a P&L line

`DataTable`'s grouped rows used to only ever collapse to a label (`Cost
Centre Group ▸`, with actual figures appearing only once you expanded into
its rows) — right for Sales Report's CC-Group-to-Cost-Centre table, wrong
for a screen like P&L's own Profit & Loss Summary, where the group row IS a
Revenue/COGS/Gross/Net figure in its own right and expanding it only drills
into the SAME figure by month. `values?: Record<string, any>` on
`DataGroup` is the difference: set it and the group's header row renders a
real, `cellText`-formatted cell per column instead of one colSpan label —
at any depth, so a `subgroups` entry (a cost centre under its group) can
carry `values` too, giving a real Group → Cost Centre → Month P&L without a
second table component. A caller that never sets it keeps the plain
label-only heading, unchanged — this is additive, not a redesign of every
existing grouped table.

`report_tag_area_costing()` (437) is `report_cost_centre_costing()`'s exact
shape read off `acct_tag_areas` / `journal_lines.tag_area` instead — no
`sales_target` there (tag areas don't carry one), everything else identical,
built so P&L's "Tag Area" filtration mode is the same `buildCostingGroups()`
call as "Cost Center", just a different source array.

**A group row with `values` needs no separate Subtotal row, and a group with
nothing to expand into needs no chevron.** The first cut of `values` still
rendered the old label-only group's trailing `subtotal` row underneath it —
a duplicate of the figures the header row itself now carries, and exactly
the "sub total should not show as total already showing in row" bug a user
caught on P&L's Cost Center grouping. `GroupRows` in `DataTable.tsx` now
skips `g.subtotal` whenever `g.values` is set (a caller can still stop
passing `subtotal` once it sets `values`, but the render guard means it
doesn't matter if one is left behind). The same render also only offers the
▾/▸ toggle and `onClick` when a group actually has `subgroups` or a
non-empty `rows` — a group whose only children would be a month drill that
isn't switched on has nothing to reveal, so it isn't drawn as if it does.
Group header rows also zebra by sibling index now (`bg-slate-50/70` on
every second row, at each depth) instead of one flat shade per depth —
before this, "Trading", "Umrah Package" and "Transport" all read the same
grey and didn't visually separate the way a flat table's own rows do.

## A cost centre's target is one number per month, not one number

`acct_cost_centers.sales_target` was a single flat figure per cost centre,
and it was wrong: "every cost center has different targets also every month
has different targets, some months target can be zero some months target
will be high some low, so target are costcenter wise and monthwise" (the
owner, checking the old software's numbers against this ERP's). A September
target of 979,750 and an eight-completed-month total of 7,414,000 can't both
come from one annual figure divided evenly — the old software held a real,
independent number per cost centre per calendar month, and this ERP now
does too.

`acct_cost_center_monthly_targets` (company_id, cost_center_id, year, month,
target) is that table, edited on the Cost Center Targets tab of
Accounting → Targets & Budget (a Year selector, cost centres as rows,
Jan–Dec as editable columns, save on blur — the same shape the Expense
Budget tab next to it already used). `report_cost_center_targets()` and
`report_cost_centre_costing()` both sum it over whichever months fall in
their `[from, to]`, instead of reading the flat column — they have to agree,
or it's the two-screens-disagree trap this file keeps flagging. `report_sales()`
carries the same sum per cost-centre-group-and-month as `by_cc_month_target`,
so the Sales Report's own "Sales vs Target of Completed Months" table reads
it without a second RPC call.

**Nothing was migrated from the old flat field.** Every cost centre's
`sales_target` was 0 at the time this was built, so nothing was lost — but
even if it hadn't been, prorating one flat number across twelve unequal
months would be inventing a distribution the business never actually held.
A month with nothing entered in the new table reads as target 0, exactly as
"some months target can be zero" says it should. The old flat field is still
on the record (the Cost Centers master's own "extra" field editor still
writes it) but no report reads it any more — it's inert, not deleted.

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

It happened again in 391, the same shape exactly: `transport_vehicle_cost_model`
declared a loop variable `r` for its accounts loop while a `transport_routes r`
join sat a few lines above in the same function — plpgsql read `r.distance_km`
there as the not-yet-assigned record `r`, not the joined route, and raised
"record "r" is not assigned yet" only when a plate actually had a driver
matched. 391's own self-check ran against a plate with no driver registered,
which skips that query entirely — passing proves the untested branch works,
nothing about the one that was never exercised. **A rehearsal is only as good
as the state it runs against**: cover the branch that matters (here, a real
driver-matched plate), not just whichever one happens to be easiest to set up
live. Fixed in 392 by renaming the loop variable to `acct_row` — a plpgsql
variable should never share a name with a table alias used anywhere else in
the same function, not just nearby.

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

`/transport/costing` answers "what does this trip actually cost, and what
should we charge for it" from data every other screen already produces —
posted vouchers, the Route Master, trips, the Tag Area master — and creates
no duplicate vehicle, route, or expense record.

**A vehicle, for costing, is a plate — not the booking category.**
`transport_vehicles` (Starex, Staria, Camry, Bus…) names the CATEGORY a
booking asks for, fulfilled by whichever physical vehicle or vendor is
assigned; it was never a list of physical assets, so the first cut of this
module (389) built cost profiles on it and got the shape wrong. The real
owned fleet is the leaves under Accounting → Tag Areas → **VEHICLES →
VISTA TRANSPORT** — four plates today (`STAREX (ATA 4086)`, `STAREX (KDA
6681)`, `STARIA (STA 6390)`, `STARIA (LUXURY)`), imported from the same
tag-area tree that names every other dimension. `transport_vista_vehicles()`
is what the module's vehicle pickers read (391), everywhere `transport_vehicles`
was read before; `transport_vehicle_cost_model(p_company, p_tag_area_id, …)`
takes one of these ids, not a `transport_vehicles` id, and refuses anything
outside that group.

**A plate's cost is exactly what was posted against it — nothing inferred.**
`transport_vehicle_cost_model()` sums every POSTED expense-type account's
journal line whose `tag_area` names this plate, grouped by the account
itself: Car Petrol, Vehicle Maintenance, Vehicle Insurance, even a driver's
iqama fee if the business chooses to tag that voucher line to this van. The
chart of accounts IS the breakdown now — there is no fixed fuel/oil/tyre/
driver taxonomy left to get wrong, and the whole class of bug 390 fixed (a
fuel receipt tagged to the wrong vehicle's driver double-counting) cannot
recur, because there is no more inference: a cost belongs to whichever tag
area a human actually chose on the voucher line. Depreciation and Fleet
Overhead are the only two "modeled" lines left, because neither has a
cash-posting equivalent in the ledger; depreciation still comes from a
per-plate Vehicle Cost Profile (`transport_vehicle_profiles`, keyed on the
tag area id, edited on the module's own Vehicle Cost Profiles tab — neither
the Vehicles master screen nor the Tag Area master itself is touched).

**Revenue has a real gap this module does not paper over.** `transport_trips`
has never recorded which specific plate ran a trip, only the category
booked, so cost (exact, from vouchers) and revenue/KM (from trips) cannot be
joined on `vehicle_id`. Asked directly, the business chose to close this by
registering each plate against the driver currently driving it —
`transport_drivers.vista_vehicle_reg` (391), set from Transport → Drivers →
Registration No. (Costing plate), picked from the same VISTA TRANSPORT list.
A trip's `driver_id` is matched back to a plate through that field. This is
an approximation for a driver who changes plates mid-period, not a per-trip
record, and the engine says so rather than hiding it:
`vehicle_match_source` reads `driver_registration_current` or
`no_driver_registered`, a plate with no driver registered gets an explicit
NO DRIVER REGISTERED warning in the Calculator, and Route Profitability
counts a trip whose driver has no registered plate in revenue but flags it
under `unmatched_owned_trips` rather than guessing which vehicle it cost.

**Fleet overhead has exactly one source, unchanged**: `transport_expenses`
rows tagged to neither a vehicle nor a driver, category `admin_overhead` —
nothing outside Transport is ever swept in. `transport_vehicle_overhead_share()`
splits that pool five ways (equal / by KM / by revenue / by active days /
manual, with "by KM" and "by vehicle utilization" being the same measure
under two names, not two different numbers); only which vehicles it is
split across moved, from the 8 categories to the 4 plates.

**Nothing is invented where the history is not there.** Direct cost with no
voucher posted yet reads `insufficient_data` rather than a fabricated
zero-looking-like-a-real-number. A `confidence` score (HIGH ≥ 12 months of
that plate's own matched-trip history, MEDIUM 3–11, LOW under 3) is measured
from actual data span, bounded by the period asked for — not the size of the
window requested — so a 12-month query against six weeks of real history
reads LOW, honestly.

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

**The KM a vehicle actually drives is more than its booked trips.**
`transport_trips` can only ever hold a real, paid booking — `booking_id` and
`sell_rate` are both `NOT NULL` — so there is no row anywhere for a driver
repositioning empty between one drop-off and the next pickup, even though
that driving is real and the fuel for it is already in Direct Expenses.
`transport_deadhead_km()` (393) is the distance twin of
`transport_deadhead_min()` — already used for scheduling feasibility, e.g.
388's Jeddah Airport grace — resolving two locations to cities via
`loc_city()` and looking the gap up in the Route Master, city pair either
direction, falling back to `transport_city_distance()`. `transport_driver_km()`
sums a driver's booked KM plus this estimated deadhead between consecutive
completed trips, and is the ONE place both `transport_vehicle_cost_model()`
(the Calculator's cost/km) and `transport_vehicle_overhead_share()`'s `by_km`
method read from, so "how far did this vehicle go" means the same thing in
both — the alternative, each re-deriving it, is exactly the "two screens
disagree" trap this file keeps finding.

**The gap is resolved through the trip's own booked ROUTE, never through
`pickup_location`/`drop_location`** (403; a first cut of `transport_driver_km()`
chained the free-text fields instead and is the wrong shape to repeat). Those
two fields are a driver's own typing — usually a specific hotel name, not a
city — so `loc_city()` had no keyword to match and silently invented a fake
"city" from the hotel's first word, which then matched nothing in the Route
Master and dropped the whole gap to 0. A route's own name is written in clean
"City/Landmark - City/Landmark" form (`transport_route_origin`/
`transport_route_dest` already parse it that way), so the gap between two
trips is the PREVIOUS trip's route destination to the NEXT trip's route
origin — what city the vehicle actually ended up in — not what a booking
form happened to have typed for that specific stop. `transport_driver_km()`
still reports how many gaps it considered and how many it could not resolve
(a route named without a " - " separator mostly), so any remaining shortfall
stays visible rather than silently absorbed into the total. Verified against
a real case: STARIA LUXURY (SXA 7141) driven by Rahat Nazar, August 2026 — 65
booked trips = 7,009 km, plus 2,790 km of resolved deadhead (62 of 64 gaps;
route-wise resolution roughly doubled it over the free-text version's 1,440,
which was silently dropping real repositioning it had no city keyword for),
moving `monthly_km` to 9,799 and `cost_per_km` down from 1.4250 to 1.0193 —
same real cost, spread over the vehicle's real distance instead of only its
billable one.

**Not every cost belongs on every route, and there is no persisted mapping
saying which does.** Car Parking is real on a Jeddah Airport transfer and
never happens on Makkah-Madinah, but `transport_vehicle_cost_model()` blends
every posted expense into one `cost_per_km` and `transport_costing_calculate()`
multiplies that same rate by any route's distance — so Makkah-Madinah was
still carrying its share of a fee it never incurs. Rather than a route↔account
master (one more table to keep in step with the Chart of Accounts), the
Calculator asks fresh on every run: `p_overrides.excluded_components` names
which of THAT call's own component keys (`acct_<id>`, `depreciation`,
`overhead`) to leave out of the total (404). Nothing is saved — the checklist
above the Calculate button is ticked by default and resets on the next
vehicle or period, so leaving everything ticked reproduces the prior result
exactly. The same mechanism doubles as "how much would cost drop if we cut
this" for any component, not only a route-specific one. `transport_costing_calculate()`
already forwarded `p_overrides` untouched, so the Calculator needed no change
beyond the checklist itself; Route Compare and Route Profitability call
`transport_vehicle_cost_model()` with a bare `{}` of their own (they price
every vehicle against one route, not one what-if), so a deselection there
would need its own plumbing if it's ever wanted.

## An air ticket booking is a hold; issuing it is loading it into the invoice

The Air Ticket Invoice has always been a complete, posting voucher — a
customer, a supplier, four legs, a bill each side. What was missing was
everything **before** it: the flight is searched outside the ERP (whichever
IATA system the deal calls for), then a booking is created that the airline
or GDS holds for a few hours or days — and releases on its own if nobody
issues it. `air_ticket_booking` (405) is that hold, tracked start to finish.

**No new table.** It is one more `trade_documents.doc_type`, the exact engine
every other trade voucher already uses (`TradeVoucher`, `trade_doc_save`,
`trade_doc_load`, `trade_doc_get` — none of them special-case a doc_type, so
none of them needed touching). It never posts: `trade_doc_save`'s posting
list does not include it, the same as `sale_order`/`sales_quotation`, so
saving one just holds the row at `status='open'` — nothing moves until it is
issued, cancelled, or the hold runs out on its own.

**Issuing is not a separate step.** It is loading the booking into an Air
Ticket Invoice — the Load button, via `air_ticket_invoice`'s `loadsFrom` and
the matching `workflow_steps` row — and saving that, exactly the way a Sale
Order becomes a Sales Invoice one document earlier in the same chain. There
is no dedicated "Issue" RPC to fall out of sync with the invoice.

**Two pieces of state live in `meta`, and "issued" is not one of them.**
`cancelled` is ticked by a person (the client backed out); `hold_status =
'expired'` is written only by `air_ticket_bookings_expire()`, the hourly
cron (folded into the existing `/api/cron/reminders` route, anon-callable
and `p_secret`-gated like the other five) once `hold_expires_at` has passed
with nothing issued. "Issued" is never stored at all — it is the same
`exists (... source_doc_id = d.id)` consumed-check every other document in
a `workflow_steps` chain already answers with, so a booking's status can
never disagree with whether its invoice actually exists.

**The dashboard is the one deviation from how every other trade voucher is
found.** A Sale Order has no list screen — a clerk finds one by typing its
number into the header's own Document No. box (`trade_doc_find`, `docNo`).
A hold's whole point is a human noticing it before it runs out, so
`/accounting/sales/air-tickets` is a worklist (`air_ticket_bookings_list()`,
`security invoker`) instead, sorted soonest-to-expire first, and a row
opens straight into that booking via `TradeVoucher`'s new `initialId` prop
(server-read from `?id=`, calling the same `load()` the docNo box already
had) rather than making staff copy a number across screens.

**Follow-up alerting reuses the existing reminder engine rather than adding
a new one.** `air_ticket.hold_expiring` is one more row in
`notification_situations` (the table `generate_custom_reminders` already
walks hourly) — an admin turns it into a threshold rule on Settings →
Notification Rules the same way the other nine situations are, and it fires
with zero new plpgsql or cron wiring.

Verified end to end before shipping: a booking held 3 hours out stayed
`held`; one 2 hours overdue flipped to `expired` on the very next
`air_ticket_bookings_expire()` call and stopped being a reminder candidate;
the still-held one loaded correctly into a fresh Air Ticket Invoice with its
supplier, PNR, sector and rate all carried across.

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

## Umrah Package (planned) — the architecture it has to fit, before a line of it is written

Visa, Hotel and Transport are three separate modules today. A combined Umrah
Package module — one screen a group's whole trip is costed and priced from —
is planned as its own build. This section is the architecture investigation
that build has to start from, recorded so it isn't redone. **Nothing in this
section has been built.** No table, column or RPC named here exists yet.

**The GL side of Visa, Hotel and Transport is fully built and switched off.**
`acct_automation_rules` already carries six correctly-configured rules —
`visa.group_created` → `visa.generate_invoice`, `visa.supplier_cost`,
`hotel.vendor_confirmed` → `hotel.post_gl`, `hotel.supplier_cost`,
`transport.trip_completed` → `transport.post_gl`, `transport.vendor_cost` —
each with real accounts and cost centres already set. All six are
`enabled = false`: migration 377 turned them on as part of moving posting onto
`trade_documents` (`visa_invoice`/`hotel_invoice`/`transport_invoice`, raised
through `trade_doc_raise`), and 378 turned them straight back off on the
record that whether they run is the business's decision. So today
`trade_documents` has not one row with `meta ? 'source_kind'`, and the whole
of `journal_entries` has nine rows, none of them visa, hotel or transport.
**`invoice_created` on a group or a trip proves none of this** — it is a
manual staff tick from migrations 129/163, predating the automation entirely,
meaning "I already typed this into the old system," and it never touches
`journal_entries`. A group or trip reading `invoice_created = true` can still
have no GL entry anywhere, and 325 of 416 groups and 598 of 839 trips do.

That is why the Package module has to be designed for **both** states at
once: read actual cost from the module tables as they stand today, and
prefer `trade_documents` once the business turns the automation on, without
a rebuild in between. Concretely: a group's visa cost is never stored — it
is derived live from the rate master (`visa_pick_product`/`visa_sell_rate`/
`visa_purchase_rate`, migration 244) keyed on `visa_type` and nights, and
stays that way until `visa_invoice` rows exist to read instead. Hotel cost
for a group is `group_brn_allocation` joined to `brn_inventory.rate_per_bed`
— **not** `hotel_bookings`/`hotel_purchase_bookings`, which is a separate,
lightly-used FIT-booking engine with its own (also off) automation rule and
no real join back to a group beyond an unenforced text `group_no`. Transport
cost is already on the trip itself (`transport_trips.vendor_cost` paid out,
`sell_rate` + `extra_charge` charged, `normal_rate` a pre-package reference
rate, `agent_sell_rate` display-only to the agent and financially inert) —
the number exists, but the trip isn't reliably tied to a group yet (next
paragraph). Reading module-table cost now and switching to `trade_documents`
later is two branches of one query, not two designs — build it that way from
the start rather than hard-coding "read the module table."

**Fix the Transport ↔ Umrah Group link before or as part of this build, not
around it.** `transport_bookings`/`transport_trips` have no foreign key to
`umrah_groups` — the only link is `transport_bookings.nusuk_group_no`
text-matched against `umrah_groups.group_no`, narrowed by the shared
`group_companies` row, through `transport_exists_for_group()`. That function
is only ever used for one compliance existence-check today, which is why the
gap has been harmless so far — a Package module summing a group's transport
cost/revenue reliably cannot be built on a text match, the exact shape of bug
this file keeps finding elsewhere (the deadhead-km `pickup_location` trap,
the two-definitions-of-a-party trap). A stored id — `transport_bookings.
umrah_group_id uuid references umrah_groups(id)`, or the reverse — is a real
schema change for the Package build itself to make, not a workaround to
design past.

**Reference, never duplicate.** `umrah_groups` (dates, pax, agent,
`group_company_id`), `group_brn_allocation`/`brn_inventory` (hotel cost),
`transport_trips` (transport cost/sell), the visa rate-master, and
`group_companies`' own accounting identity (`supplier_party_id`/
`supplier_account_id`) all stay exactly where they are — the Package module
reads them by id, the same as every other place in this ERP that avoids the
two-definitions trap. Nothing here gets a second copy on a package table.

**What genuinely has no home yet, and belongs on the Package module itself**:
the group's all-in **selling price**, its **advance schedule**, **ROE**,
**PKR cost per pax**, and **package profitability** (sell less the assembled
visa + hotel + transport + ticket cost) — none of these exist anywhere today,
on `umrah_groups` or otherwise, and none of Visa, Hotel or Transport has a
legitimate claim to them. This is the Package module's own data, to be
designed properly when that build starts — not sketched into an existing
table now.

**One naming trap for that design**: "package" already names two unrelated
things — `packages`/`package_items` (a pre-priced sales catalogue, 1 row,
hidden screen) and `transport_packages` (a transport-only fixed vehicle/route
price list). The Umrah Package module is neither. Keep its tables, RPCs and
labels clearly apart from both when the build starts.

## A customer's name is a report, not a thin profile card

Clicking a customer's name (Car Customer Balances, and anywhere else a
customer is named) opens `/car-sales/customers/[id]` — one RPC,
`car_customer_report()` (438), carrying everything the screen needs: the
ledger-true balance (`journal_lines`, the same sum `car_customer_balances()`
already reads — not `car_contracts`/`car_installments` arithmetic, which the
page used before this and which is exactly the "money questions read the
ledger" mistake this file keeps flagging elsewhere), an ageing breakdown
shaped like `ar_ap_aging()`'s own (due / overdue / 1-30 / 30+, so the two
screens never disagree on what "due" means), a billed/receipts/balance KPI
row per invoice type (Car Invoice vs Monthly Charges vs anything else billed
to the account), every bill the account has ever carried with what has been
adjusted against it (the `allocations` table `apply_billwise_allocations`
already writes to), and a monthwise due/receipt schedule.

**Invoice Type is a toggle group, not exclusive tabs** — Car Invoice /
Service Charges / Other are independent slices of the same KPI row and a
user comparing them wants more than one on screen at once, the same test
this file's multi-select section already states. A bill's own row expands
into its real `journal_lines` — the actual voucher, not a re-derived DR/CR
pair — which is why there is no separate "GL detail" RPC: journal_lines is
already RLS-scoped the way every restricted read in this ERP is, so reading
it directly for one `entry_id` is the same access a staff user already has.

**The monthwise schedule is not capped to ±3 months the way
`car_customer_monthwise()` has to be.** That function caps its window
because it runs for every customer at once, for a dashboard card — here it
is one customer, so the RPC runs the real schedule from whatever
`car_installments`/`car_service_charges`/`car_receipts` actually holds,
which for a 12-month contract reaches over a year out. This is more
complete than the old software's equivalent report needed to be, not less.

**Violation Charges has no home and was left out, not faked.** The old
software's customer report carried a Violation Charges column; VISTAERP has
no violation-charge table or posting path anywhere under Car Sales, only
`car_service_charges`. Adding a column with a schema-shaped zero behind it
is exactly the fabricated-figure trap this file warns against elsewhere —
it stays out until it is a real feature (a table, a posting routine) rather
than a column with nothing behind it.

## The Balance Sheet is classified by the account's own subtype, not by guessing

`/accounting/balance-sheet` (reached from the dashboard's Balance Sheet
card) used to be a plain two-column list of every asset/liability/equity
account with no grouping, no KPI row and none of the report system's own
visual conventions (dark-green merged header, light `bg-brand-50` grid,
zebra rows) — it read like a draft next to every other report this file
already moved onto that system. The fix is presentation, not a new report:
same `trial_balance()` call, same accounts, same total.

Assets split into **Current Assets / Fixed Assets / Other Assets** because
`accounts.subtype` already carries "Current Asset" and "Fixed Asset" as
real values the account editor writes — grouping by them uses data the
user entered, it doesn't invent a classification. **Liabilities stays split
by what the chart actually has** — Payables, Tax Payable, Other
Liabilities — rather than manufacturing a Current/Long-term split: no
liability in this chart carries a subtype that says which it is, and
guessing one would be exactly the kind of fabricated figure this file
keeps warning against elsewhere (Transport Costing's `insufficient_data`,
Car Sales' Violation Charges). An account with no subtype set lands in its
side's own "Other" bucket, visibly unclassified, instead of being folded
into Current by default. Equity keeps Drawings on its own line (already
negative, since `-net()` on a debit-balance Drawing account correctly
reduces equity) and Current-year earnings appears as its own row under
Capital & Reserves, always shown even when there is no earnings yet.

Each of the three classifications is one merged card (`DataGroup.values`
again, the same pattern P&L's Cost Centre grouping uses) with a bold total
bar under its own grid rather than a plain list, and a KPI row up top —
Total Assets, Total Liabilities, Total Equity, Current-year Earnings, and
Books (Balanced, or Off by the difference) — answers "does the business
balance" before a single row is read. Two small donuts (Asset Composition,
Financing Mix) are the one addition with no prior equivalent on this
screen, reusing `DonutChart` rather than a new chart component.

## Cash Flow is a statement, not the ledger with a filter on it

The dashboard's Cash Flow card used to open `/accounting/ledger?subtype=Cash,Bank`
— clicking through it was, in the user's own words, "it open all ledger,
this is wrong." `report_cash_flow()` (439) and `/accounting/cash-flow`
replace that with the three things a professional cash flow report always
carries (QuickBooks, Xero, SAP all shape it the same way): where cash
actually came from and went to this period, a monthly trend, and what's
already committed to arrive or leave soon.

**Cash/bank accounts are identified exactly the way `report_cash_bank()`
already does** — by chart-of-accounts path under the 1-02 (Cash) and 1-03
(Bank) groups, not by subtype — precisely so this report's balance can
never drift from what the Cash & Bank card already shows for the same
date. Re-deriving "what counts as cash" a second way is the two-screens-
disagree trap this file keeps finding; the migration's own rehearsal
cross-checked both RPCs' totals against each other before being applied.

**The direct-method statement (Operating / Investing / Financing) needs no
per-voucher-type special-casing, because double-entry does the work.** For
every posted entry that touches a cash/bank account in the period, its
OTHER (non-cash) lines are summed by (credit − debit), grouped by that
line's own account `subtype`/`nature` (Receivable → Received from
Customers, Payable → Paid to Suppliers, Fixed Asset → Investing, Drawing/
Equity → Financing, everything else → Operating Expenses / Other Income /
Other). Because debits equal credits within every entry, this sum is
*exactly* the period's net cash movement — nothing is estimated,
apportioned, or specific to Receipt/Payment/Car Sale/whatever voucher
raised the entry. A transfer between two of the company's own cash/bank
accounts (a Contra voucher) has no non-cash line at all, so it drops out
on its own instead of being counted as both an inflow and an outflow.

**"What's coming and what's due" reads `open_items`, bucketed exactly the
way `ar_ap_aging()` and the car customer report already bucket it** —
overdue / due this month / next 30 days / beyond 30 — rather than a fourth
definition of the same buckets. `direction = 'D'` is a receivable (expected
cash IN), `'C'` is a payable (expected cash OUT); both are already on
`open_items` and needed no join back through `accounts.subtype` to work
out which side a bill is on. "Cash Now" plus expected inflows less expected
outflows within 30 days is the one projected figure on the screen, and it
says so in its own label rather than presenting a projection as a fact.

## Sales Report: "View By" is one shared multi-select, not a picker per section

CC Group, Cost Centre, Customer and Product are four different things to
slice the SAME sales total by — not four mutually exclusive views of one
thing — so a user wanting Cost Centre and Customer on screen together is
asking for exactly what the multi-select test in this file already says
yes to. The report had two single-select pickers that got this wrong: the
Monthwise Sales pivot could only be on one dimension at a time, and the
flat "Cost Centre Group wise Sales — LY vs CY" table had no picker at
all — it was hard-coded to CC Group, so "I want to see by cost centre" had
nowhere to go.

One shared `dims: Set<Dim>` ("View By", `DIM_ORDER` = ccGroup/costCentre/
customer/product) now drives both: the LY vs CY table renders once per
selected dimension (`lyVsCy()` merges that dimension's current- and
previous-year arrays — `py`, the previous-year fetch, already carries the
full `SalesData` shape, so Cost Centre/Customer/Product all had a previous-
year array sitting right there, just never read for this table before),
and the Monthwise pivot renders once per selected dimension too
(`MonthwisePivotTable`, extracted so four instances don't mean four copies
of the same ~70-line table). Selecting all four stacks four tables; keep
at least one selected, same convention as every other multi-select toggle
in this file.

**Sales vs Target of Completed Months was already built (395/436) — it was
just invisible when nothing had a target yet.** `TARGET_DIMS` narrows the
shared "View By" selection to `ccGroup`/`costCentre`, the only two with a
target concept (`acct_cost_center_monthly_targets` is keyed on a cost
centre; a customer or a product has none), and now renders unconditionally
whenever a completed month exists in the selected period — previously the
whole section vanished silently once `salesVsTargetCompleted.length === 0`,
which is indistinguishable from "not built" to someone who has not yet
entered a target on Accounting → Targets & Budget. It now shows the section
with an explicit empty message pointing at that screen instead of
disappearing.

**The Target/Achievement/Difference KPIs are the sum of whichever months
`PeriodDropdown` has selected, not always the whole year** — that was
already true (`report_cost_center_targets` is called with the
PeriodDropdown's own `[from,to]`), but the KPI cards didn't say so, so
"is this month's target or the year's" had to be guessed. Each of those
three labels now carries `periodLabel(ym)` directly (`Target — Jan-Aug
2026`, say), the same "state the range in the label rather than leaving it
to be inferred" rule this file's report-design section already applies to
`PageHeader` titles.

## Every report in the ERP has been swept for filtration, once

"check in every report that where filteration needed is there filteration
if not make filteration with multi selection" — every report screen in the
ERP was read against the multi-select test above and either left alone,
converted, or given a filter it was missing outright. This was a one-time
sweep (three parallel passes: Accounting; Inventory/Stock; Car Sales/
Hotels/Transport/Visa), not a standing process — a **new** report still has
to apply the test itself; nothing re-checks this automatically.

**Two shared filter bars already covered most of Inventory/Stock
correctly**, and were left untouched: `components/reports/ReportFilters.tsx`
(driving 11 of the 14 `/stock/*` screens through `ReportRunner.tsx`) and
`components/inventory/ReportFilters.tsx` (the older, narrower twin driving
Stock Ledger and Multi-level Movement). Both already do Items / Cost
Centre / Tag Area / Account / Product as genuine multi-select tree
pickers. **One dimension across every stock report is single-select and
arguably shouldn't be**: Warehouse (`Filters.warehouse: string | null`,
feeding 13 RPCs whose signature takes a bare `p_wh uuid`, not `uuid[]`).
Fixing it means changing those RPC signatures (`uuid` → `uuid[]`,
`= p_wh` → `= any(p_wh)`) as well as both filter bars — a real backend
change that was flagged rather than faked with a client-side-only filter
that would silently narrow to one warehouse while claiming to filter by
several. Not done yet.

**Screens fixed for missing filtration** (all found showing everything
with no way to narrow it, several with no date bound at all on a table
that could grow indefinitely — the exact `select() without a bound`
shape this file already warns about elsewhere, just for display rather
than for the 1000-row PostgREST cap):
- `accounting/audit/page.tsx` — had zero controls; gained a From/To range
  (single-select, a date window) plus an Action multi-select toggle
  (`AuditFilters.tsx`) over the real action values `acct_log`/audit
  inserts actually write.
- `accounting/customers/[id]/page.tsx` — Recent Transactions was
  hard-coded to `yearSA()-01-01`..today with no control at all, despite
  calling `report_transactions()`, the same RPC Transactions Report
  already exposes a period picker for. Gained `CustomerPeriodControl.tsx`
  (the standard `PeriodDropdown`, correctly single-select).
- `car-sales/accounting/page.tsx` — every posted car journal entry ever,
  bounded only by `.limit(20000)`. Gained an Entry Date From/To range.
- `hotels/reports/page.tsx` — City/Agent sales-purchase-profit with no
  date bound at all, unlike every other module's reports. Gained a
  Booking Date From/To range.
- `inventory/history/page.tsx` — had no filter at all where its sibling
  `inventory/archived/page.tsx` already had one. Gained the same
  `CompanyFilter` (correctly single-select — company is a workspace
  partition here, which legal entity's BRNs, not an additive report
  criterion the way Cost Centre or Tag Area are).
- `car-sales/reports/delivery/page.tsx` — Sold/Delivered/Pending only
  ever showed as KPI counts, with the table itself unfilterable. Gained
  a Delivered/Pending multi-select toggle (`DeliveryTable.tsx`, extracted
  from the server page so the filter can be client-side).
- `car-sales/reports/service-charges/page.tsx` — Ownership (Vista-owned
  vs Transferred) was a column but not a filter. Gained the same toggle
  shape (`ServiceChargeTable.tsx`), with the footer total row recomputed
  against the filtered rows rather than the whole list.

**Everything else was already correct or genuinely needs no filter**, and
was left alone rather than forced into a filter bar it doesn't need — a
single-item lookup (Stock Query), a fixed reconciliation table that has
to show every account to balance (Trial Balance), a fixed ageing-bucket
snapshot where the buckets ARE the filter (Car Aging), a nested nothing-
to-narrow date window (Car Sales Upcoming's 7/30/60 days), a genuine
layout-swap tab (Car Sales Outstanding's Ageing vs Monthly, Targets &
Budget's three data-entry tabs), and two ledger tables
(`transport/reports/ledger`, `visa/invoices`) that were already multi-
select per-column pickers richer than the toggle-button pattern itself.

## A DataTable group starts collapsed, and "multi-select" never means "one table per selection"

Two more mistakes the report sweep above didn't catch, both from live
owner feedback on P&L and Sales Report after the sweep shipped:

**Every `DataTable` group used to open on load.** Its collapse state
tracked which keys were CLOSED, starting as an empty `Set` — meaning
nothing was closed, so every group rendered fully expanded the moment the
page loaded, and the ▸/▾ only ever let you close something, never the
other way round. `expanded: Set<string>` (tracking which keys are OPEN
instead, same empty-set-by-default) fixes this the right way round: a
report opens showing only its group *totals*, and a group's rows appear
only once the viewer clicks ▸. This is a change to `DataTable.tsx` itself,
so it reaches every grouped report at once — P&L, Balance Sheet, Cash &
Bank, Aging, Cost Centre Costing, Sales Report, every grouped Inventory
report through `ReportRunner` — not a per-page fix.

**"Multi-select" filtration does not mean "render N full tables side by
side."** Sales Report's first cut of "View By" did exactly that: picking
CC Group and Customer together spawned two entire separate boxes, each
with its own header and its own copy of the grid — which is what the
owner's screenshot of the old software was pointing at as wrong, not the
idea of combining dimensions itself. The fix is the same ▸/▾ `DataGroup`
pattern P&L already uses: ONE table, and each selected dimension becomes
one collapsible group *inside* it (`lyVsCyGroups`, `salesVsTargetGroups` —
one `DataGroup` per dimension, `subtotal` carrying that dimension's own
totals since the rows underneath have no `values` of their own). The
Monthwise Sales pivot needed the same fix but couldn't reuse `DataTable`
directly — its two-row month/Value-Qty header isn't expressible in
`DataTable`'s generic `Col` system — so `MonthwisePivotTable` in
`SalesReportView.tsx` was rewritten to manage its own `expanded: Set<Dim>`
state (same empty-by-default rule) and render one shared header with a
collapsible group row per dimension, rather than one whole table per
dimension. **The lesson for any future multi-select section**: combining
N selections means N collapsible sections in one grid, never N grids.

`Sales vs Target of Completed Months`'s title also used to spell out every
completed month by name (`Jan-26, Feb-26, …, Aug-26`) after the word
"Completed" — a list "Completed Months" already says the meaning of. The
title is just `Sales vs Target of Completed Months` now; which months
counted is answered by the word itself, not a comma-separated repeat of it.

**Two Current Month KPIs were added so an owner reads today's tracking at
a glance without touching the period picker.** `Target — <period>` and
`Achievement % — <period>` follow whatever PeriodDropdown is set to
(usually the whole year), which answers a different question ("are we on
pace for the year") from "how is *this* month doing" — the number an
owner actually opens the report to check most days. `Current Month
Target` and `Current Month Achievement %` sit right beside the existing
`Current Month` sales figure, always scoped to the real calendar month
regardless of the period picker, fed by a second `report_cost_center_targets()`
call bounded to `monthStartSA()`..the month's own last day (not today) —
the full month's target, so a partial month is honestly compared against
a whole one rather than a target prorated to flatter the percentage.

**Checked every other hand-rolled group-expand outside `DataTable`, asked
to after the P&L/Sales Report fix.** Most were already right —
`AgingRows.tsx`, the car customer report's bill drill-down, and the
Orders Report / Advance-vs-Receipt line-item expansions all track OPEN
state (`useState<string | null>(null)`, `open: Set<string>` starting
empty) the way `DataTable` does now, so they were never affected. One more
had the exact same bug: Inventory's Multi-level Stock Movement
(`components/inventory/MultiLevelMovement.tsx`) tracked `collapsed:
Record<string, boolean>` and read a group as open whenever
`collapsed[id]` was `undefined` — true for every group on load, the
identical "closed-state-starting-empty-means-open" mistake `DataTable`
itself had. Fixed the same way: renamed to `expanded`, read `open =
!!expanded[id]`, so it starts collapsed like everything else now does. Two
kinds of tree were deliberately left alone: the Chart-of-Accounts-style
master trees (`AccountTree.tsx`, `AccountPickTree.tsx`, `TreeMaster.tsx`)
and the filter-picker trees (`TreePickList.tsx`) — neither is a report
result a viewer drills INTO, one is an always-browsable master list and
the other is a selection UI, so "starts open so you can see what's there
to pick" is the right default for those, not a bug of the same shape.

## A loss reads red — everywhere a figure can be one, not just where someone remembered

`DataTable`'s own `Cell` never coloured a negative number — money and
percentage columns rendered a loss in the same plain slate text as a
profit, so a viewer had to actually read the minus sign rather than
recognise it the way every professional accounting product (and this
ERP's own `ReportKpi` `tone` prop, already red-on-negative) lets you.
`negativeClass()` in `DataTable.tsx` is the one place this is decided now:
a `money` or `pct` column with a negative value renders `text-red-600`,
in the row cell, the flat-table footer total, and a group's subtotal row
alike — three call sites, one rule, so a total can't disagree with the
rows it sums about whether it's a loss. Deliberately scoped to
`money`/`pct` only — a negative quantity isn't a "loss" the same way, so
`qty`/`int` stay untouched. Because this lives in `DataTable` itself, it
reaches every report built on it at once: P&L, Balance Sheet, Cash & Bank,
Cash Flow, Aging, Cost Centre Costing, Sales Report, every grouped
Inventory report — a new report gets this for free just by using
`DataTable`'s `money`/`pct` column kinds, nothing to remember.

Three hand-rolled tables outside `DataTable` had the same gap and were
fixed individually, since they build their own `<td>`s:
- P&L's own "Cost Center Profit & Loss" panel already coloured a
  negative COST CENTRE red per row, but its Total footer didn't — a
  Total could be a loss while reading in the same black text as a
  profit two rows up. Fixed to match.
- Balance Sheet's three total bars (Total Assets / Liabilities / Equity)
  were always the light brand-green tint. Now `bg-red-50 text-red-700`
  when negative, the same tone Cash Flow's own section totals already
  used.
- Car Sales' Vehicle Profitability report had the opposite problem: its
  Net column was hard-coded `text-emerald-700` — always green, even for a
  car sold at a loss — and its Total row had no colour logic at all.
  Both now read the sign of the actual figure.

**P&L also dropped a stray "Full Cost Centre Costing report →" link**
under the Profit & Loss Summary panel, left over from before that panel
had its own CC Group / Cost Center / Month wise filtration — the
Summary panel already shows everything that report does, in the same
place, so the link was pointing a reader at a second copy of what they
were already looking at rather than anywhere new.

A follow-up sweep of every remaining hand-rolled (non-`DataTable`) table
in the ERP found the same gap in more places, fixed the same way — sign
read straight off the actual figure, never a hard-coded tone:

- VAT report's Net VAT Payable row (can go negative into refund territory).
- Accounting customer ledger's Ledger Balance KPI (signed — negative
  means the party is in credit).
- Sales Orders Report, Purchase Orders Report (header row and nested
  line rows) and Advance vs Receipt — all three carry a Balance column
  that's a genuine variance (advance − received, or the reverse) that can
  go negative on an overpayment or over-receipt.
- Car Sales' Ageing Summary Led. Bal column (had a Dr/Cr suffix but no
  colour) and the Held report's Outstanding column.
- Hotel Reports' Profit column (By City / By Agent) — same hard-coded-green
  bug as Car Sales' Vehicle Profitability.
- Transport Costing's Dashboard tab (Most/Least Profitable Route tiles
  were hard-coded green/red regardless of the route's actual margin
  sign) and several Profit/Margin figures across the Calculator, Route
  Profitability and Fleet tabs that had no colour logic at all.
- Multi-level Stock Movement, Stock Ledger and Stock Query's own balance
  columns (opening/closing value, running balance, warehouse value) — a
  negative balance is a real data issue (stock over-issued past zero),
  so it gets the same treatment; the period's own Receipt/Issue totals
  and every `qty` column stay out of scope, same as `DataTable`'s rule.

**A `DataGroup` with `subtotal` but no `values` is still a blank header
row, and that's a bug, not a style choice.** Sales Report's own LY-vs-CY
and Sales-vs-Target sections looked broken — a group collapsed to just
its label with no figures anywhere, arrows pointing at nothing — because
`lyVsCyGroups`/`salesVsTargetGroups` set `subtotal` (which `GroupRows`
only ever draws as a footer *under* the expanded rows) instead of
`values` (which draws real, formatted cells directly on the header row,
visible before anything is clicked). This is the exact "a group row that
is itself a P&L line" feature P&L already used — Sales Report just never
got converted when that feature shipped, so the group rows quietly went
back to the old label-only shape from before it existed. Fixed by
switching all three of this file's `DataGroup` builders (`ccGroups`,
`lyVsCyGroups`, `salesVsTargetGroups`) to `values`; `ccGroups` also lost
its old `meta` caption text (which folded only the target into a small
grey string) now that Target/CY/PY/Difference/Difference%/Contribution
are each their own real, sign-coloured, sortable-formatted column on the
group's own row. A caller that sets `subtotal` without `values` is not a
smaller or simpler version of this pattern — it is the old, pre-`values`
shape, and looks broken the same way this did.

The rule for anywhere else a profit-or-loss figure shows up, hand-rolled
or not: color follows the SIGN of the actual number, never a fixed class
picked because the figure is "usually positive" — the Vehicle Profitability
bug is exactly what that shortcut produces.
