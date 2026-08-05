"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LedgerRange({ from, to, rows }: { from: string; to: string; rows: any[] }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  function exportCsv() {
    const head = ["Trip Date", "Time", "Supplier", "Customer", "Haji Name", "Booking Car", "Driver", "Route", "Trip Fare", "Supplier Amount"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")].concat(
      rows.map((r) => [r.trip_date, r.trip_time, r.supplier_name, r.customer_name, r.haji_name, r.booking_car,
        r.driver_name, r.route, r.trip_fare, r.supplier_amount].map(esc).join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `transport-ledger-${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="no-print mb-4 flex flex-wrap items-end gap-2">
      <div><label className="label">From</label><input type="date" className="input" value={f} onChange={(e) => setF(e.target.value)} /></div>
      <div><label className="label">To</label><input type="date" className="input" value={t} onChange={(e) => setT(e.target.value)} /></div>
      <button className="btn text-sm" onClick={() => router.push(`/transport/reports/ledger?from=${f}&to=${t}`)}>Apply</button>
      <button className="btn-outline text-sm" onClick={exportCsv} disabled={!rows.length}>⬇ Export CSV</button>
    </div>
  );
}
