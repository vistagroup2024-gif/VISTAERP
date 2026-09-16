import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, yearSA, monthStartSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";

export const dynamic = "force-dynamic";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function lastMonthRange(): [string, string] {
  const t = todaySA(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(last)}`];
}
/** Same period, one year back — for the like-for-like Current Year vs
 *  Previous Year comparisons below, not a full previous calendar year. */
function shiftYear(d: string, delta: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  return `${y + delta}-${pad(m)}-${pad(dd)}`;
}

const EMPTY = { total: 0, txns: 0, monthly: [] as any[], by_cost_centre: [] as any[], by_customer: [] as any[], by_product: [] as any[] };

// Sales Report — the dashboard's Sales card detail screen, and the full
// business analysis the reporting audit asked for: report_sales() (409,
// extended 421/423) is the one "every sale the business made" definition
// dashboard_metrics() already established; report_cost_center_targets()
// (already live, used by Targets & Budget) supplies Target vs Actual, now
// with cost_center_group for the group-level roll-up. Current Month/
// Previous Month/Previous Year are three more calls to the SAME verified
// RPC with different date ranges, not a second calculation.
export default async function SalesReportPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from || `${yearSA()}-01-01`;
  const to = searchParams.to || todaySA();
  const [lmFrom, lmTo] = lastMonthRange();
  const cmFrom = monthStartSA(), cmTo = todaySA();
  const pyFrom = shiftYear(from, -1), pyTo = shiftYear(to, -1);

  const [
    { data: salesData }, { data: targetsData },
    { data: curMonthData }, { data: prevMonthData }, { data: prevYearData },
  ] = await Promise.all([
    sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: from, p_to: to }),
    sb.rpc("report_cost_center_targets", { p_from: from, p_to: to }),
    sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: cmFrom, p_to: cmTo }),
    sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: lmFrom, p_to: lmTo }),
    sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: pyFrom, p_to: pyTo }),
  ]);

  const s = (salesData as any) ?? EMPTY;
  const py = (prevYearData as any) ?? EMPTY;
  const curMonth = (curMonthData as any) ?? EMPTY;
  const prevMonth = (prevMonthData as any) ?? EMPTY;
  const targets = ((targetsData as any[]) ?? []).filter((r) => Number(r.actual || 0) || Number(r.target || 0));

  const totalTarget = targets.reduce((a, r) => a + Number(r.target || 0), 0);
  const achievement = totalTarget > 0 ? (Number(s.total) / totalTarget) * 100 : null;
  const avgSale = s.txns > 0 ? Number(s.total) / s.txns : 0;
  const totalQty = s.by_product.reduce((a: number, r: any) => a + Number(r.qty || 0), 0);

  // Target vs Actual, rolled up to Cost Centre GROUP (UMRAH PACKAGE,
  // TRADING, TRANSPORT, SERVICE CHARGES, ... — real groups already in the
  // chart, read off cost_center_group targets() now carries).
  const groupMap = new Map<string, { target: number; actual: number }>();
  for (const r of targets) {
    const g = groupMap.get(r.cost_center_group) ?? { target: 0, actual: 0 };
    g.target += Number(r.target || 0); g.actual += Number(r.actual || 0);
    groupMap.set(r.cost_center_group, g);
  }
  const groupRows = Array.from(groupMap.entries()).map(([name, v]) => ({
    name, target: v.target, actual: v.actual, difference: v.actual - v.target,
    achievement: v.target > 0 ? (v.actual / v.target) * 100 : null,
  })).sort((a, b) => b.actual - a.actual);

  // Cost Centre: Current Year vs Previous Year (the same period, one year
  // back), plus each centre's share of this period's total.
  const ccNames = Array.from(new Set([...s.by_cost_centre.map((r: any) => r.name), ...py.by_cost_centre.map((r: any) => r.name)]));
  const ccRows = ccNames.map((name) => {
    const cy = s.by_cost_centre.find((r: any) => r.name === name)?.amount ?? 0;
    const pyAmt = py.by_cost_centre.find((r: any) => r.name === name)?.amount ?? 0;
    return {
      name, current_year: cy, previous_year: pyAmt, difference: cy - pyAmt,
      difference_pct: pyAmt !== 0 ? ((cy - pyAmt) / Math.abs(pyAmt)) * 100 : null,
      contribution: Number(s.total) !== 0 ? (cy / Number(s.total)) * 100 : 0,
    };
  }).sort((a, b) => b.current_year - a.current_year);

  // Monthly, Jan–Dec of the filtered period's own years, with an average
  // per transaction alongside the total.
  const monthlyRows = s.monthly.map((m: any) => {
    const [, mm] = m.month.split("-");
    return { month: m.month, month_label: `${MONTH_NAMES[Number(mm) - 1]} ${m.month.slice(0, 4)}`, txns: m.txns, amount: m.amount, average: m.txns > 0 ? Number(m.amount) / m.txns : 0 };
  });

  const customerRows = s.by_customer.map((r: any) => ({
    ...r, contribution: Number(s.total) !== 0 ? (Number(r.amount) / Number(s.total)) * 100 : 0,
  }));

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

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Summary</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Kpi label="Total Sales (period)" value={money(s.total)} />
          <Kpi label="Current Month" value={money(curMonth.total)} />
          <Kpi label="Previous Month" value={money(prevMonth.total)} />
          <Kpi label="Previous Year (same period)" value={money(py.total)} />
          <Kpi label="Target" value={money(totalTarget)} />
          <Kpi label="Achievement %" value={achievement === null ? "No target set" : `${achievement.toFixed(1)}%`}
            tone={achievement !== null ? (achievement >= 100 ? "text-green-700" : achievement >= 80 ? "text-amber-700" : "text-red-600") : undefined} />
          <Kpi label="Difference vs Target" value={money(Number(s.total) - totalTarget)} tone={Number(s.total) - totalTarget >= 0 ? "text-green-700" : "text-red-600"} />
          <Kpi label="Transactions" value={String(s.txns)} />
          <Kpi label="Quantity" value={new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(totalQty)} />
          <Kpi label="Average Sale" value={money(avgSale)} />
        </div>
      </div>

      {s.monthly.length > 1 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly Trend</h2>
          <TrendChart data={s.monthly} xKey="month" series={[{ key: "amount", label: "Sales" }]} />
        </div>
      )}

      {groupRows.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Target vs Actual, by Cost Centre Group</h2>
          <TrendChart data={groupRows} xKey="name" series={[{ key: "actual", label: "Actual" }, { key: "target", label: "Target" }]} />
          <div className="mt-2">
            <DataTable
              cols={[
                { key: "name", label: "Cost Centre Group" },
                { key: "target", label: "Target", kind: "money", total: true },
                { key: "actual", label: "Actual", kind: "money", total: true },
                { key: "difference", label: "Difference", kind: "money", total: true },
                { key: "achievement", label: "Achievement %", kind: "pct" },
              ]}
              rows={groupRows} empty="No cost centre groups with activity or targets." />
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Cost Centre — Current Year vs Previous Year</h2>
        <DataTable
          cols={[
            { key: "name", label: "Cost Centre", href: (r: any) => `/accounting/transactions?cc=${encodeURIComponent(r.name)}&from=${from}&to=${to}` },
            { key: "current_year", label: "Current Year", kind: "money", total: true },
            { key: "previous_year", label: "Previous Year", kind: "money", total: true },
            { key: "difference", label: "Difference", kind: "money", total: true },
            { key: "difference_pct", label: "Difference %", kind: "pct" },
            { key: "contribution", label: "Contribution %", kind: "pct" },
          ]}
          rows={ccRows} empty="No sales in this period." />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly</h2>
        <DataTable
          cols={[
            { key: "month_label", label: "Month" },
            { key: "txns", label: "Quantity (Txns)", kind: "int" },
            { key: "amount", label: "Sales", kind: "money", total: true },
            { key: "average", label: "Average Sale", kind: "money" },
          ]}
          rows={monthlyRows} empty="No sales in this period." />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Customer</h2>
          <DataTable
            cols={[
              { key: "name", label: "Customer", href: (r: any) => r.account_id ? `/accounting/customers/${r.account_id}` : null },
              { key: "txns", label: "Transactions", kind: "int" },
              { key: "amount", label: "Sales", kind: "money", total: true },
              { key: "contribution", label: "Contribution %", kind: "pct" },
            ]}
            rows={customerRows} empty="No sales in this period." />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Product / Vehicle / Service</h2>
          <DataTable
            cols={[
              { key: "name", label: "Product / Vehicle / Service" },
              { key: "qty", label: "Qty", kind: "qty" },
              { key: "amount", label: "Sales", kind: "money", total: true },
            ]}
            rows={s.by_product} empty="No product-level sales in this period." />
        </div>
      </div>
    </div>
  );
}
