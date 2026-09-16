import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, yearSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";

export const dynamic = "force-dynamic";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

// Sales Report — the dashboard's Sales card detail screen. report_sales()
// (migration 409) reuses the same "every sale the business made" document
// definition dashboard_metrics()'s purchase_vs_sale block already
// established; report_cost_center_targets() (already live, used by
// Targets & Budget) supplies the Target vs Actual comparison unchanged.
export default async function SalesReportPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from || `${yearSA()}-01-01`;
  const to = searchParams.to || todaySA();

  const [{ data: sales }, { data: targets }] = await Promise.all([
    sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: from, p_to: to }),
    sb.rpc("report_cost_center_targets", { p_from: from, p_to: to }),
  ]);

  const s = (sales as any) ?? { total: 0, txns: 0, monthly: [], by_cost_centre: [], by_customer: [], by_product: [] };
  const cc = ((targets as any[]) ?? []).filter((r) => Number(r.actual || 0) || Number(r.target || 0));
  const totalTarget = cc.reduce((a, r) => a + Number(r.target || 0), 0);
  const achievement = totalTarget > 0 ? (Number(s.total) / totalTarget) * 100 : null;
  const avgSale = s.txns > 0 ? Number(s.total) / s.txns : 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Sales Report" subtitle="Every sale the business made — Sales Invoice, the service invoices, and the Car Invoice — for the chosen period.">
        <PrintButton />
      </PageHeader>

      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total Sales" value={money(s.total)} />
        <Kpi label="Transactions" value={String(s.txns)} />
        <Kpi label="Average Sale" value={money(avgSale)} />
        <Kpi label="Achievement vs Target" value={achievement === null ? "No target set" : `${achievement.toFixed(1)}%`}
          tone={achievement !== null ? (achievement >= 100 ? "text-green-700" : achievement >= 80 ? "text-amber-700" : "text-red-600") : undefined} />
      </div>

      {s.monthly.length > 1 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly Trend</h2>
          <TrendChart data={s.monthly} xKey="month" series={[{ key: "amount", label: "Sales" }]} />
        </div>
      )}

      {cc.length > 0 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Target vs Actual, by Cost Centre</h2>
          <TrendChart data={cc} xKey="cost_center" series={[{ key: "actual", label: "Actual" }, { key: "target", label: "Target" }]} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Customer</h2>
          <DataTable
            cols={[{ key: "name", label: "Customer" }, { key: "txns", label: "Txns", kind: "int" }, { key: "amount", label: "Amount", kind: "money", total: true }]}
            rows={s.by_customer} empty="No sales in this period." />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Product</h2>
          <DataTable
            cols={[{ key: "name", label: "Product" }, { key: "amount", label: "Amount", kind: "money", total: true }]}
            rows={s.by_product} empty="No product-level sales in this period." />
        </div>
      </div>
    </div>
  );
}
