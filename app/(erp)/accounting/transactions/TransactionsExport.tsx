"use client";

import type { Col } from "@/lib/reports/types";
import { downloadCsv } from "@/lib/reports/export";

export default function TransactionsExport({ cols, rows }: { cols: Col[]; rows: any[] }) {
  return <button className="btn-outline" onClick={() => downloadCsv("transactions", cols, rows)}>Excel (CSV)</button>;
}
