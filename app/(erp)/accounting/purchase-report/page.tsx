import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, yearSA } from "@/lib/saudiTime";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";

export const dynamic = "force-dynamic";
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

// Purchase Report — report_purchases() (migration 413), the same posted
// Purchase Voucher definition dashboard_metrics()'s purchase_vs_sale block
// already uses, broken down by month, cost centre, supplier and product.
export default async function PurchaseReportPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from || `${yearSA()}-01-01`;
  const to = searchParams.to || todaySA();
  const { data } = await sb.rpc("report_purchases", { p_company: COMPANY_ID, p_from: from, p_to: to });
  const p = (data as any) ?? { total: 0, txns: 0, monthly: [], by_cost_centre: [], by_supplier: [], by_product: [] };
  const avg = p.txns > 0 ? Number(p.total) / p.txns : 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Purchase Report" subtitle="Every posted Purchase Voucher for the chosen period, by supplier, product and cost centre.">
        <PrintButton />
      </PageHeader>
      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total Purchase" value={money(p.total)} />
        <Kpi label="Transactions" value={String(p.txns)} />
        <Kpi label="Average" value={money(avg)} />
        <Kpi label="Suppliers" value={String(p.by_supplier.length)} />
      </div>

      {p.monthly.length > 1 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly Trend</h2>
          <TrendChart data={p.monthly} xKey="month" series={[{ key: "amount", label: "Purchases" }]} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Supplier</h2>
          <DataTable
            cols={[
              { key: "name", label: "Supplier", href: (r: any) => r.account_id ? `/accounting/ledger?account=${r.account_id}&from=${from}&to=${to}` : null },
              { key: "txns", label: "Txns", kind: "int" },
              { key: "amount", label: "Amount", kind: "money", total: true },
            ]}
            rows={p.by_supplier} empty="No purchases in this period." />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Product</h2>
          <DataTable
            cols={[{ key: "name", label: "Product" }, { key: "qty", label: "Qty", kind: "qty" }, { key: "amount", label: "Amount", kind: "money", total: true }]}
            rows={p.by_product} empty="No product-level purchases in this period." />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">By Cost Centre</h2>
        <DataTable
          cols={[
            { key: "name", label: "Cost Centre", href: (r: any) => r.name && r.name !== "Unassigned" ? `/accounting/transactions?cc=${encodeURIComponent(r.name)}&type=purchase_voucher&from=${from}&to=${to}` : null },
            { key: "txns", label: "Txns", kind: "int" },
            { key: "amount", label: "Amount", kind: "money", total: true },
          ]}
          rows={p.by_cost_centre} empty="No purchases in this period." />
      </div>
    </div>
  );
}
