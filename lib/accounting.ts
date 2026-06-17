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
