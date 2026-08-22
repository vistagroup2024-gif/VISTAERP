"use client";

import { useMemo, useState } from "react";

interface Veh { id: string; name: string }
interface RRow { id: string; name: string; cells: (number | null)[] }

export default function AgentRatesTable({ vehicles, rows, currency }: { vehicles: Veh[]; rows: RRow[]; currency: string }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.name.toLowerCase().includes(s)) : rows;
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <input className="input max-w-xs" placeholder="Search route…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th sticky left-0 bg-slate-50">Route</th>
              {vehicles.map((v) => <th key={v.id} className="th text-right">{v.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td sticky left-0 bg-white font-medium text-slate-800">{r.name}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className="td text-right tabular-nums">{c != null ? `${c.toFixed(0)} ${currency}` : <span className="text-slate-300">—</span>}</td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="td text-slate-400" colSpan={vehicles.length + 1}>No rates available.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
