"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";
import { defaultYearMonths, monthRanges, type YearMonths } from "@/lib/reports/period";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const EMPTY = { total: 0, txns: 0, monthly: [] as any[], by_cost_centre: [] as any[], by_supplier: [] as any[], by_product: [] as any[] };

// Purchase Report — report_purchases() (migration 413), the same posted
// Purchase Voucher definition dashboard_metrics()'s purchase_vs_sale block
// already uses, broken down by month, cost centre, supplier and product.
// Year+Months replaces the old From/To form; only the bounding {from,to} of
// the months picked is sent (report_purchases takes one p_from/p_to pair,
// same as before — a gapped pick reads as the span across it, not a
// precise multi-range merge).
export default function PurchaseReportView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [p, setP] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  const ranges = monthRanges(ym);
  const from = ranges[0]?.from ?? `${ym.year}-01-01`;
  const to = ranges[ranges.length - 1]?.to ?? `${ym.year}-12-31`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    sb.rpc("report_purchases", { p_company: COMPANY_ID, p_from: from, p_to: to }).then(({ data }) => {
      if (!live) return;
      setP((data as any) ?? EMPTY);
      setLoading(false);
    });
    return () => { live = false; };
  }, [sb, from, to]);

  const avg = p.txns > 0 ? Number(p.total) / p.txns : 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Purchase Report">
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReportKpi label="Total Purchase" value={money(p.total)} icon="purchase" tone="info" />
        <ReportKpi label="Transactions" value={String(p.txns)} icon="receipt" />
        <ReportKpi label="Average" value={money(avg)} icon="purchase" />
        <ReportKpi label="Suppliers" value={String(p.by_supplier.length)} icon="masters" />
      </div>

      {p.monthly.length > 1 && (
        <div className="card">
          <SectionHeader title={`Monthly Trend${loading ? " (loading…)" : ""}`} />
          <TrendChart data={p.monthly} xKey="month" series={[{ key: "amount", label: "Purchases" }]} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionHeader title="By Supplier" />
          <DataTable
            cols={[
              { key: "name", label: "Supplier", href: (r: any) => r.account_id ? `/accounting/ledger?account=${r.account_id}&from=${from}&to=${to}` : null },
              { key: "txns", label: "Txns", kind: "int" },
              { key: "amount", label: "Amount", kind: "money", total: true },
            ]}
            rows={p.by_supplier} empty="No purchases in this period." />
        </div>
        <div>
          <SectionHeader title="By Product" />
          <DataTable
            cols={[{ key: "name", label: "Product" }, { key: "qty", label: "Qty", kind: "qty" }, { key: "amount", label: "Amount", kind: "money", total: true }]}
            rows={p.by_product} empty="No product-level purchases in this period." />
        </div>
      </div>

      <div>
        <SectionHeader title="By Cost Centre" />
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
