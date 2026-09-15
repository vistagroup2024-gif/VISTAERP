import { createClient } from "@/lib/supabase/server";
import { resolveCostCenters } from "@/lib/costCenterTree";

// NOTE — there is deliberately no whole-ledger loader here any more.
//
// `loadLedger()` used to read EVERY posted journal line and add them up in
// JavaScript to produce a trial balance: assets, liabilities, equity, income,
// net profit. PostgREST stops at 1000 rows and says nothing, so past that it
// would have gone on returning a tidy set of figures, all of them wrong —
// exactly how the Daily Calendar came to disagree with itself over BRN beds.
// It had no callers, so nothing was ever wrong; it was a trap left lying about.
//
// Totals like these are counted in SQL and returned already summed:
// `trial_balance`, `acct_ledger_multi`, `dashboard_metrics`. Read a whole table
// only through `fetchAllRows`, which pages until a short page comes back.

// Postable, active accounts for voucher pickers (server-side).
//
// Reads the WHOLE tree (groups included), not just the postable rows: a
// leaf's cost centre is often its group's, per resolveCostCenters(), and
// resolving that needs the group rows in the same list. The group rows are
// dropped again once resolution is done — only postable accounts are ever
// picked from a voucher.
export async function loadPickAccounts() {
  const supabase = createClient();
  const { data } = await supabase
    .from("accounts")
    .select("id, code, name, subtype, type, currency, parent_id, cost_center_id, is_postable, status")
    .order("code");
  const rows = data ?? [];
  const effectiveCC = resolveCostCenters(rows.map((a: any) => ({ id: a.id, parent_id: a.parent_id, cost_center_id: a.cost_center_id })));
  const accounts = rows
    .filter((a: any) => a.is_postable && a.status === "active")
    .map((a: any) => ({
      id: a.id, code: a.code, name: a.name, subtype: a.subtype, nature: a.type, currency: a.currency,
      cost_center_id: effectiveCC.get(a.id) ?? null,
    }));
  const cashBank = accounts.filter((a) => a.subtype === "Cash" || a.subtype === "Bank");
  return { accounts, cashBank };
}

// Parties (customers/suppliers) for invoice pickers.
export async function loadParties() {
  const supabase = createClient();
  const { data } = await supabase.from("parties")
    .select("id, name, party_type, phone, currency, credit_limit")
    .eq("is_active", true).order("name");
  return (data ?? []) as any[];
}

// Revenue / expense postable accounts for invoice line accounts.
export async function loadIncomeExpenseAccounts() {
  const supabase = createClient();
  const { data } = await supabase.from("accounts")
    .select("id, code, name, type, subtype")
    .eq("is_postable", true).eq("status", "active")
    .in("type", ["income", "expense"]).order("code");
  return (data ?? []).map((a: any) => ({ id: a.id, code: a.code, name: a.name, subtype: a.subtype, nature: a.type }));
}

// Party ledger accounts (receivable/payable) with any outstanding, for settlement.
export async function loadPartyAccounts() {
  const supabase = createClient();
  const { data } = await supabase.from("accounts")
    .select("id, code, name, subtype")
    .eq("is_postable", true).not("party_id", "is", null).order("code");
  return (data ?? []).map((a: any) => ({ id: a.id, code: a.code, name: a.name, subtype: a.subtype, nature: "" }));
}
