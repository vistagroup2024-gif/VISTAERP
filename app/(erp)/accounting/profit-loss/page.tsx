import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, yearSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const pct = (n: number) => `${n.toFixed(1)}%`;

function pad(n: number) { return String(n).padStart(2, "0"); }
function lastMonthRange(): [string, string] {
  const t = todaySA(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(last)}`];
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

export default async function ProfitLossPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const [lmFrom, lmTo] = lastMonthRange();
  const from = searchParams.from || `${yearSA()}-01-01`;
  const to = searchParams.to || todaySA();

  const [{ data }, { data: lmData }] = await Promise.all([
    sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: from || null, p_to: to || null }),
    sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }),
  ]);
  const rows = (data ?? []) as any[];

  function summarize(rs: any[]) {
    const income = rs.filter((r) => r.nature === "income").map((r) => ({ ...r, amt: Number(r.period_credit) - Number(r.period_debit) })).filter((r) => r.amt);
    const costs = rs.filter((r) => r.nature === "expense" && r.subtype === "COGS").map((r) => ({ ...r, amt: Number(r.period_debit) - Number(r.period_credit) })).filter((r) => r.amt);
    const expense = rs.filter((r) => r.nature === "expense" && r.subtype !== "COGS").map((r) => ({ ...r, amt: Number(r.period_debit) - Number(r.period_credit) })).filter((r) => r.amt);
    const totInc = income.reduce((s, r) => s + r.amt, 0);
    const totCost = costs.reduce((s, r) => s + r.amt, 0);
    const totExp = expense.reduce((s, r) => s + r.amt, 0);
    const gross = totInc - totCost;
    const net = gross - totExp;
    return { income, costs, expense, totInc, totCost, totExp, gross, net };
  }

  const cur = summarize(rows);
  const lm = summarize((lmData ?? []) as any[]);
  const grossMargin = cur.totInc !== 0 ? (cur.gross / cur.totInc) * 100 : 0;
  const netMargin = cur.totInc !== 0 ? (cur.net / cur.totInc) * 100 : 0;
  const netChange = lm.net !== 0 ? ((cur.net - lm.net) / Math.abs(lm.net)) * 100 : null;

  const Section = ({ title, sectionRows, total }: { title: string; sectionRows: any[]; total: number }) => (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-700">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {sectionRows.map((r) => (
            <tr key={r.id} className="border-b border-slate-50">
              <td className="px-4 py-1.5"><Link href={`/accounting/ledger?account=${r.id}&from=${from}&to=${to}`} className="hover:text-brand hover:underline">{r.name}</Link></td>
              <td className="px-4 py-1.5 text-right tabular-nums">{money(r.amt)}</td>
            </tr>
          ))}
          {sectionRows.length === 0 && <tr><td className="px-4 py-3 text-slate-400">None</td><td /></tr>}
        </tbody>
        <tfoot><tr className="border-t-2 border-slate-200 font-semibold"><td className="px-4 py-2">Total {title}</td><td className="px-4 py-2 text-right tabular-nums">{money(total)}</td></tr></tfoot>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Profit & Loss" subtitle="Income less cost of sales, less expenses, for the chosen period — compared against last month.">
        <PrintButton />
      </PageHeader>
      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Revenue" value={money(cur.totInc)} />
        <Kpi label="Gross Margin %" value={pct(grossMargin)} tone={grossMargin >= 0 ? "text-slate-800" : "text-red-600"} />
        <Kpi label="Net Margin %" value={pct(netMargin)} tone={netMargin >= 0 ? "text-green-700" : "text-red-600"} />
        <Kpi label="Net vs Last Month" value={netChange === null ? "—" : `${netChange >= 0 ? "+" : ""}${netChange.toFixed(1)}%`}
          tone={netChange === null ? undefined : netChange >= 0 ? "text-green-700" : "text-red-600"} />
      </div>

      <Section title="Income" sectionRows={cur.income} total={cur.totInc} />
      <Section title="Cost of Sales" sectionRows={cur.costs} total={cur.totCost} />
      <div className={`card flex items-center justify-between font-semibold ${cur.gross >= 0 ? "text-slate-800" : "text-red-700"}`}>
        <span>Gross {cur.gross >= 0 ? "Profit" : "Loss"}</span><span className="tabular-nums">{money(Math.abs(cur.gross))}</span>
      </div>
      <Section title="Expenses" sectionRows={cur.expense} total={cur.totExp} />
      <div className={`card flex items-center justify-between text-lg font-bold ${cur.net >= 0 ? "text-green-700" : "text-red-700"}`}>
        <span>Net {cur.net >= 0 ? "Profit" : "Loss"}</span><span className="tabular-nums">{money(Math.abs(cur.net))}</span>
      </div>
    </div>
  );
}
