import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TrialBalancePage() {
  const supabase = createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, code, name, type")
    .order("code");

  // Pull all posted journal lines with their entry status
  const { data: lines } = await supabase
    .from("journal_lines")
    .select("account_id, debit, credit, journal_entries!inner(status)")
    .eq("journal_entries.status", "posted");

  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const l of lines ?? []) {
    const cur = byAccount.get(l.account_id) ?? { debit: 0, credit: 0 };
    cur.debit += Number(l.debit);
    cur.credit += Number(l.credit);
    byAccount.set(l.account_id, cur);
  }

  let totalDr = 0;
  let totalCr = 0;
  const rows = (accounts ?? []).map((a) => {
    const t = byAccount.get(a.id) ?? { debit: 0, credit: 0 };
    const net = t.debit - t.credit;
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    totalDr += debit;
    totalCr += credit;
    return { ...a, debit, credit, has: t.debit !== 0 || t.credit !== 0 };
  }).filter((r) => r.has);

  return (
    <div>
      <PageHeader title="Trial Balance" />
      <p className="mb-4 text-sm text-slate-500">Posted entries only · base currency (PKR)</p>
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Code</th>
              <th className="th">Account</th>
              <th className="th text-right">Debit</th>
              <th className="th text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td font-mono">{r.code}</td>
                <td className="td">{r.name}</td>
                <td className="td text-right">{r.debit ? money(r.debit, "PKR") : ""}</td>
                <td className="td text-right">{r.credit ? money(r.credit, "PKR") : ""}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={4}>No posted entries yet. Post an invoice or record a receipt to populate the ledger.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
              <td className="td" colSpan={2}>Totals</td>
              <td className="td text-right">{money(totalDr, "PKR")}</td>
              <td className="td text-right">{money(totalCr, "PKR")}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {rows.length > 0 && totalDr !== totalCr && (
        <p className="mt-3 text-sm text-red-600">⚠ Trial balance does not tie out — investigate unbalanced entries.</p>
      )}
    </div>
  );
}
