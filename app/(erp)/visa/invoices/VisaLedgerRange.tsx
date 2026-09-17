"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dateStr } from "@/lib/format";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import { defaultYearMonths, monthRanges, type YearMonths } from "@/lib/reports/period";

export const VISA_TYPE_LABEL: Record<string, string> = { masar: "Masar", normal: "Non-Masar", long_stay: "Long Stay" };

// The period control sits in the title row now (PageHeader's children),
// beside Print — no separate From/To row of its own. Applying navigates
// via router.push the same way the old Apply button did (this page's own
// data fetch and admin check stay server-side, untouched); only the
// control choosing from/to changed.
export default function VisaLedgerRange({ from, to, rows }: { from: string; to: string; rows: any[] }) {
  const router = useRouter();
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);

  function apply(next: YearMonths) {
    setYm(next);
    const ranges = monthRanges(next);
    const f = ranges[0]?.from ?? `${next.year}-01-01`;
    const t = ranges[ranges.length - 1]?.to ?? `${next.year}-12-31`;
    router.push(`/visa/invoices?from=${f}&to=${t}`);
  }

  function exportCsv() {
    const head = ["Date", "Company", "Customer", "Name", "Group No", "Visa Type", "Total Nights", "Pax", "Invoice Created"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")].concat(
      rows.map((r) => [dateStr(r.visa_date), r.company, r.customer, r.group_name, r.group_no,
        VISA_TYPE_LABEL[r.visa_type] ?? r.visa_type, r.total_nights ?? "", r.pax ?? "",
        r.invoice_created ? "Yes" : "No"].map(esc).join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `visa-invoices-${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PeriodDropdown value={ym} onChange={apply} />
      <button className="btn-outline text-sm" onClick={exportCsv} disabled={!rows.length}>⬇ Export CSV</button>
    </>
  );
}
