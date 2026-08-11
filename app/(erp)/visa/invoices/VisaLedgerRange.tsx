"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dateStr } from "@/lib/format";

export const VISA_TYPE_LABEL: Record<string, string> = { masar: "Masar", normal: "Non-Masar", long_stay: "Long Stay" };

export default function VisaLedgerRange({ from, to, rows }: { from: string; to: string; rows: any[] }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

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
    <div className="no-print mb-4 flex flex-wrap items-end gap-2">
      <div><label className="label">From</label><input type="date" className="input" value={f} onChange={(e) => setF(e.target.value)} /></div>
      <div><label className="label">To</label><input type="date" className="input" value={t} onChange={(e) => setT(e.target.value)} /></div>
      <button className="btn text-sm" onClick={() => router.push(`/visa/invoices?from=${f}&to=${t}`)}>Apply</button>
      <button className="btn-outline text-sm" onClick={exportCsv} disabled={!rows.length}>⬇ Export CSV</button>
    </div>
  );
}
