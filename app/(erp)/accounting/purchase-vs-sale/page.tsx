import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
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

// Purchase vs Sale — report_purchases() (413) and report_sales() (409) are
// the same two definitions dashboard_metrics()'s own purchase_vs_sale block
// already established, side by side. Margin is sale less cost of sales off
// the ledger (the Gross Profit already shown on the P&L), not sale less what
// was bought — buying two cars and selling one is not a loss.
export default async function PurchaseVsSalePage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from || `${yearSA()}-01-01`;
  const to = searchParams.to || todaySA();

  const [{ data: purch }, { data: sales }] = await Promise.all([
    sb.rpc("report_purchases", { p_company: COMPANY_ID, p_from: from, p_to: to }),
    sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: from, p_to: to }),
  ]);
  const p = (purch as any) ?? { total: 0, monthly: [], by_cost_centre: [], by_supplier: [], by_product: [] };
  const s = (sales as any) ?? { total: 0, monthly: [], by_cost_centre: [], by_customer: [], by_product: [] };

  const months = Array.from(new Set([...p.monthly.map((m: any) => m.month), ...s.monthly.map((m: any) => m.month)])).sort();
  const combinedMonthly = months.map((m) => ({
    month: m,
    purchase: p.monthly.find((x: any) => x.month === m)?.amount ?? 0,
    sale: s.monthly.find((x: any) => x.month === m)?.amount ?? 0,
  }));

  const ccNames = Array.from(new Set([...p.by_cost_centre.map((c: any) => c.name), ...s.by_cost_centre.map((c: any) => c.name)]));
  const combinedCc = ccNames.map((name) => ({
    name,
    purchase: p.by_cost_centre.find((x: any) => x.name === name)?.amount ?? 0,
    sale: s.by_cost_centre.find((x: any) => x.name === name)?.amount ?? 0,
  }));

  // Product-wise — both report_purchases() and report_sales() now carry qty
  // alongside amount (a car sale included: report_sales() no longer drops it
  // just because it has no acct_products line).
  const productNames = Array.from(new Set([...p.by_product.map((x: any) => x.name), ...s.by_product.map((x: any) => x.name)]));
  const combinedProduct = productNames.map((name) => {
    const pp = p.by_product.find((x: any) => x.name === name);
    const ss = s.by_product.find((x: any) => x.name === name);
    return {
      name, purchase_qty: pp?.qty ?? 0, purchase_value: pp?.amount ?? 0,
      sale_qty: ss?.qty ?? 0, sale_value: ss?.amount ?? 0,
    };
  }).sort((a, b) => (b.purchase_value + b.sale_value) - (a.purchase_value + a.sale_value));

  return (
    <div className="space-y-4">
      <PageHeader title="Purchase vs Sale" subtitle="What was bought against what was sold — same document-level definitions the dashboard card uses.">
        <PrintButton />
      </PageHeader>
      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total Purchases" value={money(p.total)} />
        <Kpi label="Total Sales" value={money(s.total)} />
        <Kpi label="Purchase Transactions" value={String(p.txns ?? 0)} />
        <Kpi label="Sale Transactions" value={String(s.txns ?? 0)} />
      </div>

      {combinedMonthly.length > 1 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly Comparison</h2>
          <TrendChart data={combinedMonthly} xKey="month" series={[{ key: "sale", label: "Sale" }, { key: "purchase", label: "Purchase" }]} />
        </div>
      )}
      {combinedCc.length > 0 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Cost Centre</h2>
          <TrendChart data={combinedCc} xKey="name" series={[{ key: "sale", label: "Sale" }, { key: "purchase", label: "Purchase" }]} />
        </div>
      )}

      {/* Charts show the shape; these tables are what the exact numbers
         actually are, and what the charts above are exportable/readable as. */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly</h2>
        <DataTable
          cols={[
            { key: "month", label: "Month" },
            { key: "purchase", label: "Purchase Value", kind: "money", total: true },
            { key: "sale", label: "Sale Value", kind: "money", total: true },
          ]}
          rows={combinedMonthly} empty="No activity in this period." />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">By Product</h2>
        <DataTable
          cols={[
            { key: "name", label: "Product / Vehicle / Service" },
            { key: "purchase_qty", label: "Purchase Qty", kind: "qty" },
            { key: "purchase_value", label: "Purchase Value", kind: "money", total: true },
            { key: "sale_qty", label: "Sale Qty", kind: "qty" },
            { key: "sale_value", label: "Sale Value", kind: "money", total: true },
          ]}
          rows={combinedProduct} empty="No product-level activity in this period." />
      </div>
    </div>
  );
}
