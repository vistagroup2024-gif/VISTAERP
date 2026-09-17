"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";
import { defaultYearMonths, monthRanges, type YearMonths } from "@/lib/reports/period";

const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const EMPTY_P = { total: 0, txns: 0, monthly: [] as any[], by_cost_centre: [] as any[], by_supplier: [] as any[], by_product: [] as any[] };
const EMPTY_S = { total: 0, txns: 0, monthly: [] as any[], by_cost_centre: [] as any[], by_customer: [] as any[], by_product: [] as any[] };

// Purchase vs Sale — report_purchases() (413) and report_sales() (409) are
// the same two definitions dashboard_metrics()'s own purchase_vs_sale block
// already established, side by side. Margin is sale less cost of sales off
// the ledger (the Gross Profit already shown on the P&L), not sale less
// what was bought — buying two cars and selling one is not a loss.
// Year+Months replaces the old From/To form; only the bounding {from,to}
// of the months picked is sent to both RPCs (each takes one p_from/p_to
// pair, same as before).
export default function PurchaseVsSaleView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [p, setP] = useState(EMPTY_P);
  const [s, setS] = useState(EMPTY_S);
  const [loading, setLoading] = useState(true);

  const ranges = monthRanges(ym);
  const from = ranges[0]?.from ?? `${ym.year}-01-01`;
  const to = ranges[ranges.length - 1]?.to ?? `${ym.year}-12-31`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      sb.rpc("report_purchases", { p_company: COMPANY_ID, p_from: from, p_to: to }),
      sb.rpc("report_sales", { p_company: COMPANY_ID, p_from: from, p_to: to }),
    ]).then(([{ data: purch }, { data: sales }]) => {
      if (!live) return;
      setP((purch as any) ?? EMPTY_P);
      setS((sales as any) ?? EMPTY_S);
      setLoading(false);
    });
    return () => { live = false; };
  }, [sb, from, to]);

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
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReportKpi label="Total Purchases" value={money(p.total)} icon="purchase" />
        <ReportKpi label="Total Sales" value={money(s.total)} icon="sales" tone="info" />
        <ReportKpi label="Purchase Transactions" value={String(p.txns ?? 0)} icon="receipt" />
        <ReportKpi label="Sale Transactions" value={String(s.txns ?? 0)} icon="receipt" />
      </div>

      {combinedMonthly.length > 1 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly Comparison{loading ? " (loading…)" : ""}</h2>
          <TrendChart data={combinedMonthly} xKey="month" series={[{ key: "sale", label: "Sale" }, { key: "purchase", label: "Purchase" }]} />
        </div>
      )}
      {combinedCc.length > 0 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">By Cost Centre</h2>
          <TrendChart data={combinedCc} xKey="name" series={[{ key: "sale", label: "Sale" }, { key: "purchase", label: "Purchase" }]} />
        </div>
      )}

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
