"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { sar, OWNERSHIP_LABEL, vehicleTitle } from "../../lib";

type Row = {
  vehicle: {
    id: string; ownership: string; plate_no?: string | null;
    item?: string | null; make?: string | null; model?: string | null; variant?: string | null; model_year?: number | null;
  };
  customer: string; charged: number; paid: number; outstanding: number; overdue: number; months: number;
};

const OWNERSHIPS = Object.keys(OWNERSHIP_LABEL);

// Vista-owned and Transferred are independent slices of the same vehicle
// list — a user comparing what's still Vista's against what's been handed
// over wants both on screen at once as often as just one — so this is a
// toggle group over a Set, not an exclusive tab. Both selected (the
// default) reproduces the table's original, unfiltered contents exactly.
export default function ServiceChargeTable({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(OWNERSHIPS));

  function toggle(o: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(o) && next.size > 1) next.delete(o); else next.add(o);
      return next;
    });
  }

  const shown = useMemo(() => rows.filter((r) => selected.has(r.vehicle.ownership)), [rows, selected]);
  const t = shown.reduce((a, r) => ({ charged: a.charged + r.charged, paid: a.paid + r.paid, outstanding: a.outstanding + r.outstanding, overdue: a.overdue + r.overdue }), { charged: 0, paid: 0, outstanding: 0, overdue: 0 });

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap gap-2">
        {OWNERSHIPS.map((o) => (
          <button key={o} onClick={() => toggle(o)}
            className={`rounded-full px-3 py-1 text-sm ${selected.has(o) ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {OWNERSHIP_LABEL[o]}
          </button>
        ))}
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full min-w-[860px]">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr>
            <th className="px-4 py-2.5 text-left"><span className="col-resize">Vehicle</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Customer</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Ownership</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Months</span></th>
            <th className="px-4 py-2.5 text-right"><span className="col-resize">Charged</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Paid</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Outstanding</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Overdue</span></th>
          </tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.vehicle.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                <td className="td"><Link href={`/car-sales/vehicles/${r.vehicle.id}`} className="text-brand hover:underline">{vehicleTitle(r.vehicle)}</Link><div className="text-xs text-slate-400">{r.vehicle.plate_no ?? ""}</div></td>
                <td className="td">{r.customer}</td>
                <td className="td">{OWNERSHIP_LABEL[r.vehicle.ownership] ?? r.vehicle.ownership}</td>
                <td className="td text-right">{r.months}</td>
                <td className="td text-right tabular-nums">{sar(r.charged)}</td>
                <td className="td text-right tabular-nums">{sar(r.paid)}</td>
                <td className="td text-right tabular-nums font-medium">{sar(r.outstanding)}</td>
                <td className="td text-right tabular-nums text-red-600">{sar(r.overdue)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No charges for this selection.</td></tr>}
          </tbody>
          {shown.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
            <td className="td" colSpan={4}>Total ({shown.length} vehicles)</td>
            <td className="td text-right tabular-nums">{sar(t.charged)}</td><td className="td text-right tabular-nums">{sar(t.paid)}</td>
            <td className="td text-right tabular-nums">{sar(t.outstanding)}</td><td className="td text-right tabular-nums">{sar(t.overdue)}</td>
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
