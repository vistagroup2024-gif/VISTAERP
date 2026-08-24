import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default async function BalanceSheetPage({ searchParams }: { searchParams: { as_of?: string } }) {
  const sb = createClient();
  const asOf = searchParams.as_of ?? "";
  const { data } = await sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: null, p_to: asOf || null });
  const rows = (data ?? []) as any[];
  const net = (r: any) => Number(r.closing_net); // debit − credit

  const assets = rows.filter((r) => r.nature === "asset").map((r) => ({ ...r, amt: net(r) })).filter((r) => r.amt);
  const liabilities = rows.filter((r) => r.nature === "liability").map((r) => ({ ...r, amt: -net(r) })).filter((r) => r.amt);
  const equity = rows.filter((r) => r.nature === "equity" || r.nature === "control").map((r) => ({ ...r, amt: -net(r) })).filter((r) => r.amt);
  // Current-year earnings not yet closed = −(income+expense cumulative net).
  const earnings = -rows.filter((r) => r.nature === "income" || r.nature === "expense").reduce((s, r) => s + net(r), 0);

  const totA = assets.reduce((s, r) => s + r.amt, 0);
  const totL = liabilities.reduce((s, r) => s + r.amt, 0);
  const totE = equity.reduce((s, r) => s + r.amt, 0) + earnings;
  const balanced = Math.abs(totA - (totL + totE)) < 0.01;

  const Section = ({ title, rows, extra }: { title: string; rows: any[]; extra?: { name: string; amt: number } }) => (
    <div className="card p-0">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-700">{title}</div>
      <table className="w-full text-sm"><tbody>
        {rows.map((r) => (<tr key={r.id} className="border-b border-slate-50"><td className="px-4 py-1.5"><span className="font-mono text-xs text-slate-400">{r.code}</span> {r.name}</td><td className="px-4 py-1.5 text-right tabular-nums">{money(r.amt)}</td></tr>))}
        {extra && <tr className="border-b border-slate-50"><td className="px-4 py-1.5 italic text-slate-600">{extra.name}</td><td className="px-4 py-1.5 text-right tabular-nums">{money(extra.amt)}</td></tr>}
      </tbody></table>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Balance Sheet" />
      <form className="card flex flex-wrap items-end gap-3" method="get">
        <div><label className="label">As of</label><input type="date" name="as_of" defaultValue={asOf} className="input" /></div>
        <button className="btn">Run</button>
        <span className={`ml-auto rounded-full px-3 py-1 text-sm font-medium ${balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {balanced ? "Balanced ✓" : `Off by ${money(Math.abs(totA - (totL + totE)))}`}
        </span>
      </form>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={`Assets — ${money(totA)}`} rows={assets} />
        <div className="space-y-4">
          <Section title={`Liabilities — ${money(totL)}`} rows={liabilities} />
          <Section title={`Equity — ${money(totE)}`} rows={equity} extra={{ name: "Current-year earnings", amt: earnings }} />
        </div>
      </div>
    </div>
  );
}
