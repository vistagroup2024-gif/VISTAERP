import { createClient } from "@/lib/supabase/server";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number; // total debits posted
  credit: number; // total credits posted
  net: number; // debit - credit
};

/**
 * Aggregates all POSTED journal lines by account, in base currency (PKR).
 * Returns accounts that have activity plus convenience totals by type.
 */
export async function loadLedger() {
  const supabase = createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, code, name, type")
    .order("code");

  const { data: lines } = await supabase
    .from("journal_lines")
    .select("account_id, debit, credit, journal_entries!inner(status)")
    .eq("journal_entries.status", "posted");

  const agg = new Map<string, { debit: number; credit: number }>();
  for (const l of lines ?? []) {
    const cur = agg.get(l.account_id) ?? { debit: 0, credit: 0 };
    cur.debit += Number(l.debit);
    cur.credit += Number(l.credit);
    agg.set(l.account_id, cur);
  }

  const ledger: LedgerAccount[] = (accounts ?? []).map((a: any) => {
    const t = agg.get(a.id) ?? { debit: 0, credit: 0 };
    return { ...a, debit: t.debit, credit: t.credit, net: t.debit - t.credit };
  });

  const sumNet = (type: AccountType) =>
    ledger.filter((a) => a.type === type).reduce((s, a) => s + a.net, 0);

  const totalIncome = -sumNet("income"); // income carries credit balance
  const totalExpense = sumNet("expense"); // expense carries debit balance
  const netProfit = totalIncome - totalExpense;

  return {
    ledger,
    totals: {
      assets: sumNet("asset"),
      liabilities: -sumNet("liability"),
      equity: -sumNet("equity"),
      income: totalIncome,
      expense: totalExpense,
      netProfit,
    },
  };
}

// Postable, active accounts for voucher pickers (server-side).
export async function loadPickAccounts() {
  const supabase = createClient();
  const { data } = await supabase
    .from("accounts")
    .select("id, code, name, subtype, type")
    .eq("is_postable", true)
    .eq("status", "active")
    .order("code");
  const accounts = (data ?? []).map((a: any) => ({
    id: a.id, code: a.code, name: a.name, subtype: a.subtype, nature: a.type,
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
