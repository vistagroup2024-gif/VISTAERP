import PageHeader from "@/components/PageHeader";
import { loadLedger } from "@/lib/accounting";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProfitLossPage() {
  const { ledger, totals } = await loadLedger();
  const income = ledger.filter((a) => a.type === "income" && (a.debit || a.credit));
  const expense = ledger.filter((a) => a.type === "expense" && (a.debit || a.credit));

  return (
    <div className="max-w-2xl">
      <PageHeader title="Profit & Loss" />
      <p className="mb-4 text-sm text-slate-500">Posted entries · base currency (PKR)</p>

      <div className="card space-y-6">
        <section>
          <h2 className="mb-2 font-semibold text-slate-700">Income</h2>
          <table className="w-full text-sm">
            <tbody>
              {income.map((a) => (
                <tr key={a.id} className="border-b border-slate-50">
                  <td className="py-2"><span className="font-mono text-slate-400">{a.code}</span> {a.name}</td>
                  <td className="py-2 text-right">{money(-a.net, "PKR")}</td>
                </tr>
              ))}
              {income.length === 0 && <tr><td className="py-2 text-slate-400">No income posted.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <td className="py-2">Total Income</td>
                <td className="py-2 text-right">{money(totals.income, "PKR")}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section>
          <h2 className="mb-2 font-semibold text-slate-700">Expenses</h2>
          <table className="w-full text-sm">
            <tbody>
              {expense.map((a) => (
                <tr key={a.id} className="border-b border-slate-50">
                  <td className="py-2"><span className="font-mono text-slate-400">{a.code}</span> {a.name}</td>
                  <td className="py-2 text-right">{money(a.net, "PKR")}</td>
                </tr>
              ))}
              {expense.length === 0 && <tr><td className="py-2 text-slate-400">No expenses posted.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <td className="py-2">Total Expenses</td>
                <td className="py-2 text-right">{money(totals.expense, "PKR")}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <div className={`flex items-center justify-between rounded-lg px-4 py-3 ${totals.netProfit >= 0 ? "bg-green-50" : "bg-red-50"}`}>
          <span className="font-semibold">{totals.netProfit >= 0 ? "Net Profit" : "Net Loss"}</span>
          <span className={`text-xl font-bold ${totals.netProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
            {money(totals.netProfit, "PKR")}
          </span>
        </div>
      </div>
    </div>
  );
}
