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
const EMPTY = { total: 0, by_account: [] as any[], monthly: [] as any[], rows: [] as any[] };

// Drawings Report — report_drawings() (migration 416), the DRAWING account
// group (subtype 'Drawing') the chart of accounts already has. Year+Months
// replaces the old From/To form; only the bounding {from,to} of the months
// picked is sent (report_drawings takes one p_from/p_to pair, same as
// before).
export default function DrawingsReportView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [d, setD] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  const ranges = monthRanges(ym);
  const from = ranges[0]?.from ?? `${ym.year}-01-01`;
  const to = ranges[ranges.length - 1]?.to ?? `${ym.year}-12-31`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    sb.rpc("report_drawings", { p_company: COMPANY_ID, p_from: from, p_to: to }).then(({ data }) => {
      if (!live) return;
      setD((data as any) ?? EMPTY);
      setLoading(false);
    });
    return () => { live = false; };
  }, [sb, from, to]);

  const avgMonthly = d.monthly.length > 0 ? Number(d.total) / d.monthly.length : 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Drawings Report" subtitle="Owner drawings by account, for the chosen period.">
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <ReportKpi label="Total Drawings" value={money(d.total)} icon="wallet" tone="info" />
        <ReportKpi label="Monthly Average" value={money(avgMonthly)} icon="wallet" />
        <ReportKpi label="Drawing Accounts" value={String(d.by_account.length)} icon="masters" />
      </div>

      {d.monthly.length > 1 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly Trend{loading ? " (loading…)" : ""}</h2>
          <TrendChart data={d.monthly} xKey="month" series={[{ key: "amount", label: "Drawings" }]} />
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">By Account</h2>
        <DataTable
          cols={[
            { key: "name", label: "Drawing Account", href: (r: any) => r.account_id ? `/accounting/ledger?account=${r.account_id}&from=${from}&to=${to}` : null },
            { key: "amount", label: "Amount", kind: "money", total: true },
          ]}
          rows={d.by_account} empty="No drawings in this period." />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Vouchers</h2>
        <DataTable
          cols={[
            { key: "voucher", label: "Voucher" },
            { key: "date", label: "Date", kind: "date" },
            { key: "account", label: "Drawing Account", href: (r: any) => r.account_id ? `/accounting/ledger?account=${r.account_id}&from=${from}&to=${to}` : null },
            { key: "credit_account", label: "Credit Account" },
            { key: "amount", label: "Amount", kind: "money", total: true },
            { key: "remarks", label: "Remarks" },
          ]}
          rows={d.rows} empty="No drawing vouchers in this period." />
      </div>
    </div>
  );
}
