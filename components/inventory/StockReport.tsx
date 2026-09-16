"use client";

import { STOCK_REPORTS } from "@/lib/stockReports";
import ReportRunner from "@/components/reports/ReportRunner";

/** The generic Inventory report screen — now a thin call into the shared
 *  ReportRunner engine every other report module uses too. See
 *  lib/stockReports.ts for why STOCK_REPORTS is still its own registry. */
export default function StockReport({ report }: { report: string }) {
  return <ReportRunner registry={STOCK_REPORTS} report={report} />;
}
