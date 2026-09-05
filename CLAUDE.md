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

## Master data is the user's

Nothing creates or edits Product Tree items, accounts or cost centres behind the
user's back. Vouchers **choose** an existing item; they never invent one.

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
*as on* a date; today is what the agent is looking at.

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

## One dashboard, and cards are opt-in

Every card lives on `/dashboard` and is registered once in `lib/dashboardCards.ts`
— add it there and it appears both on the dashboard and in the per-user picker.
All the figures come from a single `dashboard_metrics()` call, which is
`security invoker` so a restricted user's dashboard is built from only the
accounts and products they may see.

Card access **reverses** the convention used everywhere else: an empty
`profiles.dashboard_cards` grants **nothing**. Only an admin sees every card;
everyone else sees exactly what an admin ticked. A dashboard puts the whole
company's money on one screen, so it is opt-in rather than opt-out.

There is no module dashboard any more. `/accounting`, `/car-sales`,
`/hotels/dashboard`, `/inventory` and `/transport` forward to `/dashboard` —
the routes stay so links and bookmarks keep working, but every card they used to
carry is in the register. A new card goes there, never onto a module screen.

Two things follow. The landing lists in `lib/staffSession.ts` and
`lib/supabase/middleware.ts` must not point at a forwarding route: a user
without `dashboard.view` would be sent to their landing, forwarded back to
`/dashboard`, and bounce forever. And the figures come from **two** calls —
`dashboard_metrics()` for the money and trade cards, `dashboard_module_metrics()`
for the ones absorbed from the module dashboards (Umrah, transport, hotels).

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
