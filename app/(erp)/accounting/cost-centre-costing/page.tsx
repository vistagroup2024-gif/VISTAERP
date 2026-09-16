import { createClient } from "@/lib/supabase/server";
import { todaySA, yearSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";

export const dynamic = "force-dynamic";
const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

// Cost Centre Costing — report_cost_centre_costing() (migration 417), each
// cost centre's own Target/Sales/COGS/Gross Profit/Expense/Net, off the same
// income/COGS/expense definitions the P&L and dashboard already use.
// Break-even is deliberately not shown — this schema has no fixed-vs-
// variable cost classification to compute one honestly from (see the
// migration's own comment).
export default async function CostCentreCostingPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from || `${yearSA()}-01-01`;
  const to = searchParams.to || todaySA();
  const { data } = await sb.rpc("report_cost_centre_costing", { p_from: from, p_to: to });
  const rows = ((data ?? []) as any[]).filter((r) => r.sales || r.cogs || r.expense || r.target);

  const t = rows.reduce((a, r) => ({
    target: a.target + Number(r.target || 0), sales: a.sales + Number(r.sales || 0),
    cogs: a.cogs + Number(r.cogs || 0), gross_profit: a.gross_profit + Number(r.gross_profit || 0),
    expense: a.expense + Number(r.expense || 0), net_profit: a.net_profit + Number(r.net_profit || 0),
  }), { target: 0, sales: 0, cogs: 0, gross_profit: 0, expense: 0, net_profit: 0 });
  const achievement = t.target > 0 ? (t.sales / t.target) * 100 : null;
  const gpPct = t.sales !== 0 ? (t.gross_profit / t.sales) * 100 : null;

  return (
    <div className="space-y-4">
      <PageHeader title="Cost Centre Costing" subtitle="Each cost centre's own target, sales, cost of sales, gross profit and expense.">
        <PrintButton />
      </PageHeader>
      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Target" value={money(t.target)} />
        <Kpi label="Sales" value={money(t.sales)} />
        <Kpi label="Achievement %" value={achievement === null ? "—" : `${achievement.toFixed(1)}%`} />
        <Kpi label="Gross Profit" value={money(t.gross_profit)} tone={t.gross_profit >= 0 ? "text-green-700" : "text-red-600"} />
        <Kpi label="GP %" value={gpPct === null ? "—" : `${gpPct.toFixed(1)}%`} />
        <Kpi label="Expense" value={money(t.expense)} />
        <Kpi label="Net Profit" value={money(t.net_profit)} tone={t.net_profit >= 0 ? "text-green-700" : "text-red-600"} />
      </div>

      {rows.some((r) => r.target) && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Target vs Sales, by Cost Centre</h2>
          <TrendChart data={rows} xKey="cost_centre" series={[{ key: "sales", label: "Sales" }, { key: "target", label: "Target" }]} />
        </div>
      )}

      <DataTable
        cols={[
          { key: "cost_centre", label: "Cost Centre" },
          { key: "target", label: "Target", kind: "money", total: true },
          { key: "sales", label: "Sales", kind: "money", total: true },
          { key: "variance", label: "Variance", kind: "money", total: true },
          { key: "achievement", label: "Achv %", kind: "pct" },
          { key: "cogs", label: "COGS", kind: "money", total: true },
          { key: "gross_profit", label: "Gross Profit", kind: "money", total: true },
          { key: "gp_pct", label: "GP %", kind: "pct" },
          { key: "expense", label: "Expense", kind: "money", total: true },
          { key: "net_profit", label: "Net Profit", kind: "money", total: true },
        ]}
        rows={rows}
        empty="No activity for this period."
      />
    </div>
  );
}
