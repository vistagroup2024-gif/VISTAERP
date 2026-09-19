"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, monthShort } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";
import TrendChart from "@/components/reports/charts/TrendChart";
import DataTable from "@/components/reports/DataTable";
import { defaultYearMonths, monthRanges, type YearMonths } from "@/lib/reports/period";
import type { Col } from "@/lib/reports/types";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

const SECTION_COLS: Col[] = [
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount", kind: "money", total: true },
];

type Section = { key: string; label: string; lines: { category: string; amount: number }[]; total: number };
type Bucket = { overdue: number; due: number; next30: number; later: number };
type CashFlow = {
  opening_balance: number; closing_balance: number; current_balance: number;
  monthly: { month: string; cash_in: number; cash_out: number; net: number }[];
  sections: Section[];
  forecast: { receivables: Bucket; payables: Bucket };
};

function ForecastRow({ label, b, tone }: { label: string; b: Bucket; tone: string }) {
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2 font-medium text-slate-700">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums text-red-600">{money(b.overdue)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-amber-700">{money(b.due)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(b.next30)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(b.later)}</td>
      <td className={`px-3 py-2 text-right font-bold tabular-nums ${tone}`}>{money(b.overdue + b.due + b.next30 + b.later)}</td>
    </tr>
  );
}

// Cash Flow — reached from the dashboard's Cash Flow card, which used to
// open the Ledger filtered to Cash/Bank accounts (report_cash_flow(), 439).
// Three things a professional cash flow report carries, none of which a raw
// ledger listing answers: where cash actually came from and went to this
// period (a direct-method statement, Operating/Investing/Financing), a
// monthly in/out/net trend, and what's already committed to arrive or leave
// soon (open receivables/payables by due bucket) — "what we have now" and
// "what's coming" side by side with the historical movement.
export default function CashFlowView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [data, setData] = useState<CashFlow | null>(null);

  const ranges = monthRanges(ym);
  const from = ranges[0]?.from ?? `${ym.year}-01-01`;
  const to = ranges[ranges.length - 1]?.to ?? `${ym.year}-12-31`;

  useEffect(() => {
    let live = true;
    setData(null);
    sb.rpc("report_cash_flow", { p_company: COMPANY_ID, p_from: from, p_to: to }).then(({ data: d }) => {
      if (live) setData((d as CashFlow) ?? null);
    });
    return () => { live = false; };
  }, [sb, from, to]);

  const monthly = (data?.monthly ?? []).map((m) => ({ ...m, month_label: monthShort(m.month) }));
  const cashIn = monthly.reduce((s, m) => s + Number(m.cash_in), 0);
  const cashOut = monthly.reduce((s, m) => s + Number(m.cash_out), 0);
  const netChange = cashIn - cashOut;

  const fc = data?.forecast;
  const expectedIn = fc ? fc.receivables.overdue + fc.receivables.due + fc.receivables.next30 : 0;
  const expectedOut = fc ? fc.payables.overdue + fc.payables.due + fc.payables.next30 : 0;
  const projected30d = (data?.current_balance ?? 0) + expectedIn - expectedOut;

  return (
    <div className="space-y-4">
      <PageHeader title="Cash Flow">
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      {!data ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <ReportKpi label="Opening Balance" value={money(data.opening_balance)} icon="wallet" />
            <ReportKpi label="Cash In" value={money(cashIn)} icon="trendUp" tone="pos" />
            <ReportKpi label="Cash Out" value={money(cashOut)} icon="trendDown" tone="neg" />
            <ReportKpi label="Net Change" value={money(netChange)} icon="trendUp" tone={netChange >= 0 ? "pos" : "neg"} />
            <ReportKpi label="Closing Balance" value={money(data.closing_balance)} icon="accounting" tone="info" />
          </div>

          {monthly.length > 1 && (
            <div className="card">
              <SectionHeader title="Monthly Cash In / Out" />
              <TrendChart
                data={monthly}
                xKey="month_label"
                series={[
                  { key: "cash_in", label: "Cash In", color: "#0b6a58" },
                  { key: "cash_out", label: "Cash Out", color: "#b91c1c" },
                ]}
              />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            {data.sections.map((s) => (
              <div key={s.key} className="overflow-hidden rounded-lg border border-slate-200 shadow-card">
                <div className="bg-brand-700 px-3 py-2 text-sm font-bold text-white">{s.label}</div>
                <DataTable bare cols={SECTION_COLS} rows={s.lines} empty="No activity this period." />
                <div className={`flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm font-bold ${s.total >= 0 ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700"}`}>
                  <span>Net {s.label}</span><span className="tabular-nums">{money(s.total)}</span>
                </div>
              </div>
            ))}
            {data.sections.length === 0 && (
              <div className="card text-center text-sm text-slate-400 lg:col-span-3">No cash movement in this period.</div>
            )}
          </div>

          <section>
            <SectionHeader title="What's Coming and What's Due — as of today" />
            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
              <div className="card overflow-x-auto p-0">
                <table className="report-grid w-full text-sm">
                  <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
                    <tr>
                      <th className="px-3 py-2 text-left"><span className="col-resize">Expected</span></th>
                      <th className="px-3 py-2 text-right"><span className="col-resize">Overdue</span></th>
                      <th className="px-3 py-2 text-right"><span className="col-resize">Due This Month</span></th>
                      <th className="px-3 py-2 text-right"><span className="col-resize">Next 30 Days</span></th>
                      <th className="px-3 py-2 text-right"><span className="col-resize">Beyond 30 Days</span></th>
                      <th className="px-3 py-2 text-right"><span className="col-resize">Total</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <ForecastRow label="Cash In (from customers)" b={fc!.receivables} tone="text-emerald-700" />
                    <ForecastRow label="Cash Out (to suppliers)" b={fc!.payables} tone="text-red-600" />
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:w-72">
                <ReportKpi label="Cash Now" value={money(data.current_balance)} icon="wallet" tone="info" />
                <ReportKpi label="Projected in 30 Days" value={money(projected30d)} icon="trendUp" tone={projected30d >= 0 ? "pos" : "neg"} />
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
