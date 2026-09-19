"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";
import { sar, VEHICLE_STATUS_LABEL, VEHICLE_STATUS_TONE, vehicleTitle } from "../../lib";

type Row = {
  vehicle_id: string; status: string; delivered: boolean; plate_no?: string | null;
  cost_centre?: string | null; customer?: string | null; tag_area?: string | null;
  contract_id?: string | null; invoice_no?: string | null; invoice_date?: string | null;
  invoice_amount?: number | null;
  item?: string | null; make?: string | null; model?: string | null; variant?: string | null; model_year?: number | null;
};

type Status = "delivered" | "pending";
const STATUS_LABEL: Record<Status, string> = { delivered: "Delivered", pending: "Pending" };

// Delivered / Pending are independent slices of the same sold-vehicle list —
// a user comparing them wants both on screen at once as often as just one —
// so this is a toggle group over a Set, not an exclusive tab, the same shape
// as the KPI row above it. Both selected (the default) reproduces the
// table's original, unfiltered contents exactly.
export default function DeliveryTable({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<Set<Status>>(new Set<Status>(["delivered", "pending"]));

  function toggle(s: Status) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(s) && next.size > 1) next.delete(s); else next.add(s);
      return next;
    });
  }

  const counts = useMemo(() => {
    const c: Record<Status, number> = { delivered: 0, pending: 0 };
    for (const r of rows) c[r.delivered ? "delivered" : "pending"]++;
    return c;
  }, [rows]);

  const shown = useMemo(() => rows.filter((r) => selected.has(r.delivered ? "delivered" : "pending")), [rows, selected]);

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap gap-2">
        {(["delivered", "pending"] as Status[]).map((s) => (
          <button key={s} onClick={() => toggle(s)}
            className={`rounded-full px-3 py-1 text-sm ${selected.has(s) ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {STATUS_LABEL[s]} ({counts[s]})
          </button>
        ))}
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full min-w-[900px]">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr>
            <th className="px-4 py-2.5 text-left"><span className="col-resize">Vehicle</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Cost Centre</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Customer</span></th>
            <th className="px-4 py-2.5 text-left"><span className="col-resize">Tag Area</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Invoice No</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Invoice Date</span></th>
            <th className="px-4 py-2.5 text-right"><span className="col-resize">Invoice Amount</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Status</span></th>
          </tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.vehicle_id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
                <td className="td">{vehicleTitle(r)}{r.plate_no ? <span className="ml-1 text-xs text-slate-400">{r.plate_no}</span> : null}</td>
                <td className="td">{r.cost_centre ?? "—"}</td>
                <td className="td">{r.customer ?? "—"}</td>
                <td className="td">{r.tag_area ?? "—"}</td>
                <td className="td">
                  {r.contract_id ? <Link href={`/car-sales/contracts/${r.contract_id}`} className="text-brand hover:underline">{r.invoice_no ?? "—"}</Link> : (r.invoice_no ?? "—")}
                </td>
                <td className="td">{r.invoice_date ? dateStr(r.invoice_date) : "—"}</td>
                <td className="td text-right tabular-nums">{sar(r.invoice_amount)}</td>
                <td className="td"><span className={`badge ${VEHICLE_STATUS_TONE[r.status] ?? ""}`}>{VEHICLE_STATUS_LABEL[r.status] ?? r.status}</span></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No cars in this selection.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
