// ============================================================
// Turning a spoken change request into a Claude Code task.
//
// The split here is deliberate. The model supplies the SUBSTANCE — what the
// user wants, what it touches, what must not change. This file supplies the
// FRAME: Vista's standing development rules, the repository's own conventions,
// and the safety and production constraints.
//
// The frame is assembled in code, verbatim, every time. If the model were
// asked to include the rules itself it could paraphrase them, shorten them, or
// on a bad day leave one out — and "do not modify production" is not a rule
// that should depend on a model remembering it.
// ============================================================

export interface DevRequest {
  title: string;
  objective: string;
  spoken?: string | null;
  existing_to_inspect?: string[];
  areas?: string[];
  behaviour?: string[];
  ui?: string[];
  business_rules?: string[];
  out_of_scope?: string[];
  testing?: string[];
}

// The user's standing rules, exactly as they gave them. Not summarised.
const STANDING_RULES = `
DEVELOPMENT RULES
- Inspect existing functionality first.
- Do not duplicate existing functionality.
- Do not overwrite working functionality unnecessarily.
- Reuse existing components and APIs.
- Preserve existing business logic.
- Do not change unrelated modules.
- Test in Vercel/development first.
- Do not modify production/live ERP until approved.
- Explain important changes.
- Verify the result after implementation.
`.trim();

// What anyone working in this repository needs to know before they touch it.
// Mirrors CLAUDE.md rather than restating it loosely.
const REPO_CONTEXT = `
ABOUT THIS CODEBASE
- Next.js 14 (App Router) + Supabase (Postgres, Auth, RLS). Tailwind. TypeScript.
- Data access is RPC-first: ~330 SECURITY DEFINER functions granted to
  \`authenticated\`, called with supabase.rpc(). Prefer an existing RPC over a
  new query, and prefer extending one over writing a parallel one.
- Permissions live in lib/staffPermissions.ts (staff) and lib/permissions.ts
  (B2B agents), stored as a jsonb map on profiles.permissions / b2b_agents.
  Gates run in three places and all three must agree: middleware ROUTE_PERMS,
  the server-side staffCan()/guardStaffPage(), and the DB's own
  staff_has_perm() / is_staff() guards.
- Screens hidden from the sidebar are still built, still routed and still hold
  their data — see HIDDEN_ITEMS in lib/nav.ts. If one of them is wanted again,
  UNHIDE it and carry on from what is there. Never build a second screen
  alongside it.
- Vouchers post when they are SAVED; there is no separate post button. A
  voucher type carrying an authorisation rule is held for its approvers and the
  approval posts it. Anything new that posts must go through gl_submit or
  acct_hold_document.
- Master data — Chart of Accounts, Product Tree, cost centres — belongs to the
  user. Nothing creates or edits it behind their back.
- Three different things are called "invoice": /invoices (booking invoice,
  automatic, read-only), /accounting/sales/invoices (the SI- trade voucher,
  issues stock, books COGS) and /accounting/invoices (manual Invoice / Bill).
- WhatsApp already exists twice, for two jobs: lib/whatsapp.ts (Meta Cloud API
  sender) with the transport_outbox queue, and lib/waLink.ts +
  components/WhatsAppButton.tsx + lib/waMessages.ts for click-to-chat. Do not
  add a third.
- Notifications, push, and the audit trail all exist. Reuse them.
- The repo has no test runner. \`npx tsc --noEmit\` and \`npm run build\` are the
  checks that must pass. ESLint is not configured — do not add it as part of
  an unrelated change.
`.trim();

const SAFETY = `
SAFETY AND SCOPE
- Work on the feature branch only. Do not merge, and do not deploy.
- Do not touch production or the live ERP. A Vercel preview is built from the
  branch automatically; that is where this gets tested.
- Do not run destructive SQL. A migration must be additive and reversible; say
  plainly in the PR if it is not.
- Do not weaken RLS, a permission gate, or an approval rule to make something
  work. If a gate is in the way, say so and stop.
- Do not change unrelated modules, reformat files you did not need to touch,
  or "tidy" code outside the task.
- If the request turns out to conflict with something that already exists, stop
  and explain rather than building the second version.
`.trim();

const VERIFY = `
BEFORE YOU SAY IT IS DONE
- \`npx tsc --noEmit\` passes.
- \`npm run build\` passes.
- Re-read your own diff and check it against the requirement above.
- State what you changed and why, and name anything you deliberately left out.
`.trim();

function bullets(heading: string, lines?: string[]): string | null {
  const items = (lines ?? []).map((l) => String(l).trim()).filter(Boolean);
  if (!items.length) return null;
  return [heading, ...items.map((l) => `- ${l}`)].join("\n");
}

/** Assemble the prompt that will be handed to Claude Code. */
export function buildDevPrompt(req: DevRequest): string {
  const sections = [
    `# ${req.title}`,
    "",
    "OBJECTIVE",
    req.objective.trim(),
    req.spoken ? `\nThe request as it was spoken:\n"${req.spoken.trim()}"` : null,
    "",
    bullets("INSPECT FIRST — this already exists and must be reused, not rebuilt:", req.existing_to_inspect),
    bullets("LIKELY INVOLVED", req.areas),
    bullets("REQUIRED BEHAVIOUR", req.behaviour),
    bullets("UI REQUIREMENTS", req.ui),
    bullets("BUSINESS RULES TO PRESERVE", req.business_rules),
    bullets("EXPLICITLY OUT OF SCOPE — do not change these:", req.out_of_scope),
    bullets("HOW TO TEST IT", req.testing),
    "",
    REPO_CONTEXT,
    "",
    STANDING_RULES,
    "",
    SAFETY,
    "",
    VERIFY,
  ];

  return sections.filter((s) => s !== null && s !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
