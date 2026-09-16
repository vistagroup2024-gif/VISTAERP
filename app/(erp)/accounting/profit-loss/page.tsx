import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, yearSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";

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
function shiftYear(d: string, delta: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  return `${y + delta}-${pad(m)}-${pad(dd)}`;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

// P&L — Income less cost of sales, less expenses. trial_balance() is
// unchanged and still the one verified source; report_pl_monthly() (424)
// applies the exact same income/COGS/expense classification this page's own
// summarize() already used, just grouped by month in one query.
// report_cost_centre_costing() (417) supplies the Cost Centre P&L /
// comparison section unchanged; report_drawings() (416) supplies Drawings,
// so Actual Net (what is left after owner drawings) is not a new
// calculation, just Net Profit less a figure already reported elsewhere.
export default async function ProfitLossPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const [lmFrom, lmTo] = lastMonthRange();
  const from = searchParams.from || `${yearSA()}-01-01`;
  const to = searchParams.to || todaySA();
  const pyFrom = shiftYear(from, -1), pyTo = shiftYear(to, -1);

  const [{ data }, { data: lmData }, { data: pyData }, { data: monthlyData }, { data: ccData }, { data: drawingsData }] = await Promise.all([
    sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: from || null, p_to: to || null }),
    sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }),
    sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: pyFrom, p_to: pyTo }),
    sb.rpc("report_pl_monthly", { p_company: COMPANY_ID, p_from: from, p_to: to }),
    sb.rpc("report_cost_centre_costing", { p_from: from, p_to: to }),
    sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: from, p_to: to }),
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
  const py = summarize((pyData ?? []) as any[]);
  const grossMargin = cur.totInc !== 0 ? (cur.gross / cur.totInc) * 100 : 0;
  const netMargin = cur.totInc !== 0 ? (cur.net / cur.totInc) * 100 : 0;
  const netChangeMonth = lm.net !== 0 ? ((cur.net - lm.net) / Math.abs(lm.net)) * 100 : null;
  const netChangeYear = py.net !== 0 ? ((cur.net - py.net) / Math.abs(py.net)) * 100 : null;

  const drawings = (drawingsData as any)?.total ? Number((drawingsData as any).total) : 0;
  const actualNet = cur.net - drawings;

  const monthly = ((monthlyData as any[]) ?? []).map((m) => ({ ...m, gp_pct: Number(m.revenue) !== 0 ? (Number(m.gross_profit) / Number(m.revenue)) * 100 : 0 }));
  const ccRows = ((ccData as any[]) ?? []).filter((r) => r.sales || r.cogs || r.expense || r.target);

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
      <PageHeader title="Profit & Loss" subtitle="Income less cost of sales, less expenses, for the chosen period — compared against last month and the same period last year.">
        <PrintButton />
      </PageHeader>
      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Revenue" value={money(cur.totInc)} />
        <Kpi label="Gross Margin %" value={pct(grossMargin)} tone={grossMargin >= 0 ? "text-slate-800" : "text-red-600"} />
        <Kpi label="Net Margin %" value={pct(netMargin)} tone={netMargin >= 0 ? "text-green-700" : "text-red-600"} />
        <Kpi label="Net vs Last Month" value={netChangeMonth === null ? "—" : `${netChangeMonth >= 0 ? "+" : ""}${netChangeMonth.toFixed(1)}%`}
          tone={netChangeMonth === null ? undefined : netChangeMonth >= 0 ? "text-green-700" : "text-red-600"} />
        <Kpi label="Net vs Last Year" value={netChangeYear === null ? "—" : `${netChangeYear >= 0 ? "+" : ""}${netChangeYear.toFixed(1)}%`}
          tone={netChangeYear === null ? undefined : netChangeYear >= 0 ? "text-green-700" : "text-red-600"} />
        <Kpi label="Drawings" value={money(drawings)} />
        <Kpi label="Actual Net" value={money(actualNet)} tone={actualNet >= 0 ? "text-green-700" : "text-red-600"} />
      </div>

      {monthly.length > 1 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly P&L Trend</h2>
          <TrendChart data={monthly} xKey="month" series={[{ key: "revenue", label: "Revenue" }, { key: "net_profit", label: "Net Profit" }]} />
        </div>
      )}

      <Section title="Income" sectionRows={cur.income} total={cur.totInc} />
      <Section title="Cost of Sales" sectionRows={cur.costs} total={cur.totCost} />
      <div className={`card flex items-center justify-between font-semibold ${cur.gross >= 0 ? "text-slate-800" : "text-red-700"}`}>
        <span>Gross {cur.gross >= 0 ? "Profit" : "Loss"}</span><span className="tabular-nums">{money(Math.abs(cur.gross))}</span>
      </div>
      <Section title="Expenses" sectionRows={cur.expense} total={cur.totExp} />
      <div className={`card flex items-center justify-between text-lg font-bold ${cur.net >= 0 ? "text-green-700" : "text-red-700"}`}>
        <span>Net {cur.net >= 0 ? "Profit" : "Loss"}</span><span className="tabular-nums">{money(Math.abs(cur.net))}</span>
      </div>
      {drawings !== 0 && (
        <div className="card flex items-center justify-between text-sm">
          <span className="text-slate-600">Less: Drawings</span><span className="tabular-nums text-slate-700">({money(drawings)})</span>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly P&L</h2>
        <DataTable
          cols={[
            { key: "month", label: "Month" },
            { key: "revenue", label: "Revenue", kind: "money", total: true },
            { key: "cogs", label: "COGS", kind: "money", total: true },
            { key: "gross_profit", label: "Gross Profit", kind: "money", total: true },
            { key: "gp_pct", label: "GP %", kind: "pct" },
            { key: "expense", label: "Expense", kind: "money", total: true },
            { key: "net_profit", label: "Net Profit", kind: "money", total: true },
          ]}
          rows={monthly} empty="No activity in this period." />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Cost Centre P&L</h2>
          <Link href="/accounting/cost-centre-costing" className="text-sm text-brand hover:underline">Full Cost Centre Costing report →</Link>
        </div>
        <DataTable
          cols={[
            { key: "cost_centre", label: "Cost Centre" },
            { key: "sales", label: "Sales", kind: "money", total: true },
            { key: "cogs", label: "COGS", kind: "money", total: true },
            { key: "gross_profit", label: "Gross Profit", kind: "money", total: true },
            { key: "gp_pct", label: "GP %", kind: "pct" },
            { key: "expense", label: "Expense", kind: "money", total: true },
            { key: "net_profit", label: "Net Profit", kind: "money", total: true },
          ]}
          rows={ccRows} empty="No cost centre activity in this period." />
      </div>
    </div>
  );
}
