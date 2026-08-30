import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default async function ProfitLossPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";
  const { data } = await sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: from || null, p_to: to || null });
  const rows = (data ?? []) as any[];
  const income = rows.filter((r) => r.nature === "income").map((r) => ({ ...r, amt: Number(r.period_credit) - Number(r.period_debit) })).filter((r) => r.amt);
  const expense = rows.filter((r) => r.nature === "expense").map((r) => ({ ...r, amt: Number(r.period_debit) - Number(r.period_credit) })).filter((r) => r.amt);
  const totInc = income.reduce((s, r) => s + r.amt, 0);
  const totExp = expense.reduce((s, r) => s + r.amt, 0);
  const net = totInc - totExp;

  const Section = ({ title, rows, total }: { title: string; rows: any[]; total: number }) => (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-700">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-50"><td className="px-4 py-1.5"><span className="font-mono text-xs text-slate-400">{r.code}</span> {r.name}</td><td className="px-4 py-1.5 text-right tabular-nums">{money(r.amt)}</td></tr>
          ))}
          {rows.length === 0 && <tr><td className="px-4 py-3 text-slate-400">None</td><td /></tr>}
        </tbody>
        <tfoot><tr className="border-t-2 border-slate-200 font-semibold"><td className="px-4 py-2">Total {title}</td><td className="px-4 py-2 text-right tabular-nums">{money(total)}</td></tr></tfoot>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Profit & Loss" />
      <form className="card flex flex-wrap items-end gap-3" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>
      <Section title="Income" rows={income} total={totInc} />
      <Section title="Expenses" rows={expense} total={totExp} />
      <div className={`card flex items-center justify-between text-lg font-bold ${net >= 0 ? "text-green-700" : "text-red-700"}`}>
        <span>Net {net >= 0 ? "Profit" : "Loss"}</span><span className="tabular-nums">{money(Math.abs(net))}</span>
      </div>
    </div>
  );
}
