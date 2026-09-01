import type { AiTool } from "@/lib/ai/types";
import { ok, fail, fromError, cap, num, today } from "@/lib/ai/tools/shared";

// ============================================================
// Accounting read tools.
//
// Every one of these calls the SAME RPC the corresponding screen calls, so a
// figure the assistant quotes and a figure the user sees on the screen come
// from one calculation. Nothing here re-implements an accounting rule, and
// nothing here invents a number: when a call fails the error is returned as
// an error, not smoothed over.
// ============================================================

const outstanding: AiTool = {
  name: "get_outstanding",
  description:
    "Receivables or payables aging from the accounting open-items ledger: per customer/supplier " +
    "total plus the 0-30/31-60/61-90/91-180/180+ buckets. Use this for 'today's outstanding', " +
    "'who is overdue', 'who owes more than X', and to rank customers by what they owe. " +
    "'Overdue' means anything outside the 0-30 bucket unless the user says otherwise.",
  kind: "read",
  perm: "accounting.view",
  schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["customer", "supplier"], description: "Receivables (customer) or payables (supplier). Default customer." },
      min_amount: { type: "number", description: "Only include parties whose total outstanding is at least this amount." },
      overdue_only: { type: "boolean", description: "Only parties with something outside the 0-30 day bucket." },
      limit: { type: "integer", description: "How many to return, largest first. Default 20." },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const kind = args?.kind === "supplier" ? "supplier" : "customer";
    const { data, error } = await ctx.sb.rpc("ar_ap_aging", {
      p_company: ctx.companyId, p_kind: kind, p_as_of: today(),
    });
    if (error) return fromError(error, "Could not read the aging report.");

    let rows = ((data ?? []) as any[]).map((r) => ({
      account_id: r.account_id,
      name: r.name,
      code: r.code,
      phone: r.phone ?? null,
      total: num(r.total),
      d0_30: num(r.b0), d31_60: num(r.b1), d61_90: num(r.b2), d91_180: num(r.b3), d180_plus: num(r.b4),
      overdue: num(r.b1) + num(r.b2) + num(r.b3) + num(r.b4),
    }));

    if (typeof args?.min_amount === "number") rows = rows.filter((r) => r.total >= args.min_amount);
    if (args?.overdue_only) rows = rows.filter((r) => r.overdue > 0);
    rows.sort((a, b) => b.total - a.total);

    const grand = rows.reduce((s, r) => s + r.total, 0);
    const overdue = rows.reduce((s, r) => s + r.overdue, 0);
    const { rows: shown, total, truncated } = cap(rows, Math.min(num(args?.limit) || 20, 40));

    return ok(
      { currency: "SAR", kind, matched: total, truncated, total_outstanding: grand, total_overdue: overdue, parties: shown },
      { count: total, summary: `${kind} aging — ${total} ${total === 1 ? "party" : "parties"}, SAR ${grand.toFixed(2)} outstanding`,
        link: `/accounting/aging?kind=${kind}` }
    );
  },
};

const searchParty: AiTool = {
  name: "search_party",
  description:
    "Find a customer or supplier ledger account by name, code or phone. Returns the account_id that " +
    "get_party_ledger and get_party_open_items need. Always resolve a name to an account_id with this " +
    "before quoting anything about a named party.",
  kind: "read",
  perm: "accounting.view",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Part of the name, the account code, or a phone number." },
      kind: { type: "string", enum: ["customer", "supplier", "any"], description: "Default any." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const q = String(args?.query ?? "").trim();
    if (!q) return fail("Give me a name, code or phone number to search for.");

    let sel = ctx.sb.from("accounts")
      .select("id, code, name, subtype, phone, credit_limit, credit_days, status")
      .eq("company_id", ctx.companyId)
      .eq("is_postable", true)
      .or(`name.ilike.%${q}%,code.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(25);

    if (args?.kind === "customer") sel = sel.eq("subtype", "Receivable");
    else if (args?.kind === "supplier") sel = sel.eq("subtype", "Payable");

    const { data, error } = await sel;
    if (error) return fromError(error, "Could not search accounts.");

    const rows = (data ?? []).map((a: any) => ({
      account_id: a.id, code: a.code, name: a.name, type: a.subtype,
      phone: a.phone ?? null, credit_limit: num(a.credit_limit), credit_days: a.credit_days ?? null,
      status: a.status,
    }));
    return ok({ matches: rows }, { count: rows.length, summary: `Searched accounts for "${q}" — ${rows.length} match(es)` });
  },
};

const partyLedger: AiTool = {
  name: "get_party_ledger",
  description:
    "The statement of one ledger account: opening balance and every posted entry in the period, " +
    "newest last. Use it to explain a balance. Resolve the account_id with search_party first.",
  kind: "read",
  perm: "accounting.view",
  schema: {
    type: "object",
    properties: {
      account_id: { type: "string", description: "Ledger account id from search_party or get_outstanding." },
      from: { type: "string", description: "Start date YYYY-MM-DD. Omit for all history." },
      to: { type: "string", description: "End date YYYY-MM-DD. Omit for up to today." },
    },
    required: ["account_id"],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const id = String(args?.account_id ?? "");
    if (!id) return fail("I need the ledger account id — use search_party first.");

    const { data, error } = await ctx.sb.rpc("acct_ledger", {
      p_company: ctx.companyId, p_account_ids: [id],
      p_from: args?.from || null, p_to: args?.to || null,
    });
    if (error) return fromError(error, "Could not read the ledger.");

    const d = (data ?? {}) as any;
    const all = (d.rows ?? []) as any[];
    // Keep the tail: the recent movement is what explains a current balance.
    const shown = all.slice(-40);
    let running = num(d.opening);
    for (const r of all) running += num(r.debit) - num(r.credit);

    const { data: acct } = await ctx.sb.from("accounts").select("name, code").eq("id", id).maybeSingle();

    return ok(
      {
        account: (acct as any)?.name ?? null,
        code: (acct as any)?.code ?? null,
        currency: "SAR",
        opening: num(d.opening),
        closing: running,
        note: "A positive balance is Dr (they owe us); negative is Cr (we owe them).",
        entries_total: all.length,
        showing_last: shown.length,
        entries: shown.map((r) => ({
          date: r.date, voucher: r.entry_no, narration: r.memo,
          debit: num(r.debit), credit: num(r.credit),
        })),
      },
      { count: all.length, summary: `Ledger for ${(acct as any)?.name ?? id} — ${all.length} entries`,
        link: `/accounting/ledger?account=${id}` }
    );
  },
};

const partyOpenItems: AiTool = {
  name: "get_party_open_items",
  description:
    "The unpaid invoices/bills making up one party's balance: document number, date, due date, " +
    "original amount and what is still outstanding. Use this for 'which invoices are unpaid'.",
  kind: "read",
  perm: "accounting.view",
  schema: {
    type: "object",
    properties: { account_id: { type: "string", description: "Ledger account id from search_party." } },
    required: ["account_id"],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const id = String(args?.account_id ?? "");
    if (!id) return fail("I need the ledger account id — use search_party first.");

    const { data, error } = await ctx.sb.rpc("party_outstanding", { p_company: ctx.companyId, p_account_id: id });
    if (error) return fromError(error, "Could not read the open items.");

    const rows = ((data ?? []) as any[]).map((r) => ({
      doc_no: r.doc_no, doc_date: r.doc_date, due_date: r.due_date,
      amount: num(r.amount), outstanding: num(r.outstanding), status: r.status,
      overdue: !!(r.due_date && r.due_date < today()),
    }));
    const total = rows.reduce((s, r) => s + r.outstanding, 0);
    const { rows: shown, truncated } = cap(rows);

    return ok({ currency: "SAR", count: rows.length, truncated, total_outstanding: total, items: shown },
      { count: rows.length, summary: `${rows.length} open item(s), SAR ${total.toFixed(2)}` });
  },
};

const accountingSummary: AiTool = {
  name: "get_accounting_summary",
  description:
    "Today's accounting position: cash and bank, receivables, payables and the headline figures. " +
    "Use this for 'today's accounting summary' or 'how are we doing'.",
  kind: "read",
  perm: "accounting.view",
  schema: { type: "object", properties: {}, additionalProperties: false },
  async run(_args, ctx) {
    const { data, error } = await ctx.sb.rpc("acct_dashboard", { p_company: ctx.companyId });
    if (error) return fromError(error, "Could not read the accounting dashboard.");
    return ok({ currency: "SAR", ...(data as any) }, { summary: "Accounting summary", link: "/accounting" });
  },
};

const trialBalance: AiTool = {
  name: "get_trial_balance",
  description: "Trial balance for a period — every account with activity, its debits, credits and closing balance.",
  kind: "read",
  perm: "accounting.view",
  schema: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD" },
      to: { type: "string", description: "YYYY-MM-DD" },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const { data, error } = await ctx.sb.rpc("trial_balance", {
      p_company: ctx.companyId, p_from: args?.from || null, p_to: args?.to || null,
    });
    if (error) return fromError(error, "Could not build the trial balance.");
    const rows = (data ?? []) as any[];
    const { rows: shown, total, truncated } = cap(rows);
    return ok({ currency: "SAR", accounts: total, truncated, rows: shown },
      { count: total, summary: `Trial balance — ${total} accounts`, link: "/accounting/trial-balance" });
  },
};

const findVoucher: AiTool = {
  name: "find_voucher",
  description:
    "Find a posted voucher / invoice by its number (e.g. 'SI-000123', '1763'). Returns the entry so it " +
    "can be opened or explained. Use get_voucher for the full line detail.",
  kind: "read",
  perm: "accounting.view",
  schema: {
    type: "object",
    properties: {
      entry_no: { type: "string", description: "The voucher or invoice number as the user said it." },
      source: { type: "string", description: "Optional voucher source filter, e.g. gl_receipt, gl_payment." },
    },
    required: ["entry_no"],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const no = String(args?.entry_no ?? "").trim();
    if (!no) return fail("Which voucher number?");
    const { data, error } = await ctx.sb.rpc("gl_voucher_find", { p_entry_no: no, p_source: args?.source || null });
    if (error) return fromError(error, "Could not search vouchers.");
    if (!data) return ok({ found: false }, { count: 0, summary: `No voucher matching "${no}"` });
    return ok({ found: true, voucher: data }, { count: 1, summary: `Found voucher ${no}` });
  },
};

const getVoucher: AiTool = {
  name: "get_voucher",
  description: "The full detail of one posted voucher: header, narration and every GL line.",
  kind: "read",
  perm: "accounting.view",
  schema: {
    type: "object",
    properties: { entry_id: { type: "string", description: "Journal entry id from find_voucher." } },
    required: ["entry_id"],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const id = String(args?.entry_id ?? "");
    if (!id) return fail("I need the entry id — use find_voucher first.");
    const { data, error } = await ctx.sb.rpc("gl_voucher_get", { p_entry: id });
    if (error) return fromError(error, "Could not open the voucher.");
    return ok(data, { count: 1, summary: "Opened voucher", link: `/accounting/vouchers/${id}` });
  },
};

const pendingApprovals: AiTool = {
  name: "get_pending_approvals",
  description:
    "Vouchers waiting for authorisation — what they are, for how much, and how many approvals they " +
    "still need. Use this for 'what needs approving'.",
  kind: "read",
  perm: "accounting.view",
  schema: {
    type: "object",
    properties: { status: { type: "string", enum: ["pending", "approved", "rejected"], description: "Default pending." } },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const { data, error } = await ctx.sb.rpc("pending_inbox", {
      p_company: ctx.companyId, p_status: args?.status || "pending",
    });
    if (error) return fromError(error, "Could not read the approval inbox.");
    const rows = (data ?? []) as any[];
    const { rows: shown, total, truncated } = cap(rows);
    return ok({ count: total, truncated, vouchers: shown },
      { count: total, summary: `${total} voucher(s) awaiting authorisation`, link: "/accounting/approvals" });
  },
};

export const ACCOUNTING_TOOLS: AiTool[] = [
  outstanding, searchParty, partyLedger, partyOpenItems,
  accountingSummary, trialBalance, findVoucher, getVoucher, pendingApprovals,
];
