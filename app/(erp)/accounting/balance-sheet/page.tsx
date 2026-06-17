import PageHeader from "@/components/PageHeader";
import { loadLedger } from "@/lib/accounting";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BalanceSheetPage() {
  const { ledger, totals } = await loadLedger();

  const assets = ledger.filter((a) => a.type === "asset" && (a.debit || a.credit));
  const liabilities = ledger.filter((a) => a.type === "liability" && (a.debit || a.credit));
  const equity = ledger.filter((a) => a.type === "equity" && (a.debit || a.credit));

  // Current-period earnings are not yet closed to retained earnings, so we
  // surface them as an equity line to keep the sheet in balance.
  const totalEquityWithEarnings = totals.equity + totals.netProfit;
  const totalLiabEquity = totals.liabilities + totalEquityWithEarnings;
  const balanced = Math.abs(totals.assets - totalLiabEquity) < 0.01;

  const Section = ({ title, rows, sign }: { title: string; rows: typeof ledger; sign: 1 | -1 }) => (
    <section>
      <h2 className="mb-2 font-semibold text-slate-700">{title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-slate-50">
              <td className="py-2"><span className="font-mono text-slate-400">{a.code}</span> {a.name}</td>
              <td className="py-2 text-right">{money(sign * a.net, "PKR")}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="py-2 text-slate-400">None.</td></tr>}
        </tbody>
      </table>
    </section>
  );

  return (
    <div className="max-w-2xl">
      <PageHeader title="Balance Sheet" />
      <p className="mb-4 text-sm text-slate-500">Posted entries · base currency (PKR) · as of today</p>

      <div className="card space-y-6">
        <Section title="Assets" rows={assets} sign={1} />
        <div className="flex justify-between border-t border-slate-200 pt-2 font-bold">
          <span>Total Assets</span>
          <span>{money(totals.assets, "PKR")}</span>
        </div>

        <Section title="Liabilities" rows={liabilities} sign={-1} />
        <div className="flex justify-between border-t border-slate-100 pt-2 font-medium">
          <span>Total Liabilities</span>
          <span>{money(totals.liabilities, "PKR")}</span>
        </div>

        <Section title="Equity" rows={equity} sign={-1} />
        <div className="flex justify-between border-b border-slate-50 py-2 text-sm">
          <span>Current Period Earnings</span>
          <span>{money(totals.netProfit, "PKR")}</span>
        </div>
        <div className="flex justify-between border-t border-slate-100 pt-2 font-medium">
          <span>Total Equity</span>
          <span>{money(totalEquityWithEarnings, "PKR")}</span>
        </div>

        <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-3 font-bold">
          <span>Total Liabilities + Equity</span>
          <span>{money(totalLiabEquity, "PKR")}</span>
        </div>

        {!balanced && (
          <p className="text-sm text-red-600">
            ⚠ Out of balance by {money(totals.assets - totalLiabEquity, "PKR")} — check for unbalanced journal entries.
          </p>
        )}
      </div>
    </div>
  );
}
