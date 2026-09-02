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

## Vista AI: she prepares, the user disposes

`/ai` and the dock on every screen are one conversation layer over the ERP that
already exists. She owns **no business logic and no business data**: every
figure she quotes comes from the same RPC the corresponding screen calls, under
the caller's own session.

Three rules hold the whole thing up. Breaking any of them quietly is worse than
not shipping the feature.

**1. Every tool declares a permission, and a tool without one is not
registered.** `lib/ai/registry.ts` drops it and logs — a missing gate fails
closed. The permission is checked twice: when the tool list is built for the
model, and again when a call runs. `scripts/check-ai-permissions.ts` asserts
those two never disagree; run it after touching the registry or a tool.

**2. No tool executes anything.** Write tools are named `prepare_*` and they
*stage* work in `ai_pending_actions` / `ai_dev_tasks`. Execution lives behind
`/api/ai/action` and `/api/ai/dev`, reached only by the user pressing Confirm in
their own browser. The model is not in the loop at the moment anything happens.
If a new capability needs to *do* something, it gets a preparing tool and an
executor — never an executing tool.

**3. Nothing is reported as done unless the underlying system said so.** A
partial send says "Sent 7 of 8" and names the failures. A tool that fails
returns the error; it never returns an empty success.

Everything she does is written to the existing `audit_log` as
`entity = 'ai_action'` by `ai_log_action` (definer, so it cannot be forged or
suppressed) — refused and failed calls included.

### The development workflow

She drafts Claude Code tasks; she cannot run them. `lib/devPrompt.ts` assembles
the standing development rules and this repo's conventions **in code, verbatim**
— the model supplies only the substance. Approving opens a GitHub issue
mentioning `@claude`; `.github/workflows/claude.yml` works on a branch and opens
a PR; Vercel previews it.

**Production is unreachable from the ERP, by absence.** The token carries no
`workflow` scope, no code path merges a PR, and `deploy-prod.yml` stays
`workflow_dispatch`-only. Do not add a deploy button, and do not fake a Claude
permission dialog — the GitHub action is not interactive and has no such prompt.

### Server-only env

`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`. None reach the browser; the
UI is told "configured" or "not configured" and nothing more.
