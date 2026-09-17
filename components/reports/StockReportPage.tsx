"use client";

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import StockReport from "@/components/inventory/StockReport";
import { STOCK_REPORTS } from "@/lib/stockReports";
import { defaultYearMonths, type YearMonths } from "@/lib/reports/period";
import type { Filters } from "@/components/reports/ReportFilters";

/**
 * The page chrome every Stock report page renders — title row (with the
 * PeriodDropdown in it, for a report whose `cfg.period` is set) plus the
 * ReportRunner engine underneath. A client component because the period
 * picker's state has to live above ReportRunner, in the same row as the
 * title, not a row of its own — the one thing every stock report page.tsx
 * used to duplicate (title, subtitle, `<StockReport>`) now lives here once.
 * A report with no real period (Virtual Stock, Reorder) gets no dropdown —
 * `cfg.period` is unset for those.
 */
export default function StockReportPage({ report, initialFilters }: { report: string; initialFilters?: Partial<Filters> }) {
  const cfg = STOCK_REPORTS[report];
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  if (!cfg) return <p className="text-sm text-danger-fg">Unknown report &quot;{report}&quot;.</p>;
  return (
    <div>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle}>
        {cfg.period && <PeriodDropdown value={ym} onChange={setYm} />}
      </PageHeader>
      <StockReport report={report} initialFilters={initialFilters} periodValue={cfg.period ? ym : undefined} />
    </div>
  );
}
