"use client";

import { STOCK_REPORTS } from "@/lib/stockReports";
import ReportRunner from "@/components/reports/ReportRunner";
import type { Filters } from "@/components/reports/ReportFilters";

/** The generic Inventory report screen — now a thin call into the shared
 *  ReportRunner engine every other report module uses too. See
 *  lib/stockReports.ts for why STOCK_REPORTS is still its own registry. */
export default function StockReport({ report, initialFilters }: { report: string; initialFilters?: Partial<Filters> }) {
  return <ReportRunner registry={STOCK_REPORTS} report={report} initialFilters={initialFilters} />;
}
