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

The same applies to anything hidden later: add it to `HIDDEN_ITEMS` with a note,
rather than deleting it.

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
  `security definer` reports bypass RLS, so they must ask `staff_scope_ids()`
  themselves — `acct_ledger` and `trial_balance` already do; anything new that
  reports on accounts has to as well.

Screen rights are enforced in one place for *access* (the middleware, via
`docForPath`) and at the button for the rest. A new voucher screen should take a
`rights` prop from `docRightsFor(access, doc)` the way `TradeVoucher` and
`VoucherEditor` do, and be added to `DOC_TREE`.

Nobody can widen their own access: a trigger on `profiles` blocks a non-admin
from changing their own permissions, rights, window, active flag or authorise
limit — `profiles_self_update` would otherwise allow exactly that.
