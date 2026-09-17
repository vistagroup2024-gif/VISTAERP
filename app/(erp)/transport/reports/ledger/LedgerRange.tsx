"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import { defaultYearMonths, monthRanges, type YearMonths } from "@/lib/reports/period";

// The period control sits in the title row now (PageHeader's children),
// beside Print — no separate From/To row of its own. Applying navigates
// via router.push the same way the old Apply button did (this page's data
// fetch, fare rounding and admin check all stay server-side, untouched);
// only the control choosing from/to changed.
export default function LedgerRange({ from, to, rows }: { from: string; to: string; rows: any[] }) {
  const router = useRouter();
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);

  function apply(next: YearMonths) {
    setYm(next);
    const ranges = monthRanges(next);
    const f = ranges[0]?.from ?? `${next.year}-01-01`;
    const t = ranges[ranges.length - 1]?.to ?? `${next.year}-12-31`;
    router.push(`/transport/reports/ledger?from=${f}&to=${t}`);
  }

  function exportCsv() {
    const head = ["Trip Date", "Supplier", "Customer", "Haji Name", "Booking Car", "Driver", "Route", "Trip Fare", "Supplier Amount", "Cash Received", "Invoice Created"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")].concat(
      rows.map((r) => [r.trip_date, r.supplier_name, r.customer_name, r.haji_name, r.booking_car,
        r.driver_name, r.route,
        // Whole SAR, matching the on-screen ledger.
        r.trip_fare == null ? "" : Math.round(Number(r.trip_fare)),
        r.supplier_amount == null ? "" : Math.round(Number(r.supplier_amount)),
        r.cash_received == null ? "" : Math.round(Number(r.cash_received)),
        r.invoice_created ? "Yes" : "No"].map(esc).join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `transport-ledger-${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PeriodDropdown value={ym} onChange={apply} />
      <button className="btn-outline text-sm" onClick={exportCsv} disabled={!rows.length}>⬇ Export CSV</button>
    </>
  );
}
