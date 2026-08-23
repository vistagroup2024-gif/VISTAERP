"use client";

import { useMemo, useState } from "react";

interface Veh { id: string; name: string }
interface RRow { id: string; name: string; cells: (number | null)[] }

// Two alternating tones (brand + slate) so columns are easy to read without a rainbow.
const COLS = [
  { head: "bg-brand/10 text-brand", cell: "bg-brand/5" },
  { head: "bg-slate-100 text-slate-700", cell: "bg-slate-50" },
];

function Matrix({ vehicles, rows, firstCol }: { vehicles: Veh[]; rows: RRow[]; firstCol: string }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.name.toLowerCase().includes(s)) : rows;
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <input className="input max-w-xs" placeholder={`Search ${firstCol.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-100 px-3 py-2.5 text-left font-semibold text-slate-700">{firstCol}</th>
              {vehicles.map((v, i) => (
                <th key={v.id} className={`px-3 py-2.5 text-right font-semibold ${COLS[i % COLS.length].head}`}>{v.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800">{r.name}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className={`px-3 py-2 text-right tabular-nums ${COLS[i % COLS.length].cell}`}>
                    {c != null ? <span className="font-semibold text-slate-800">{c.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span> : <span className="text-slate-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td className="px-3 py-3 text-slate-400" colSpan={vehicles.length + 1}>No rates available.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AgentRatesTable({ routeVehicles, routeRows, packageVehicles, packageRows }: {
  routeVehicles: Veh[]; routeRows: RRow[]; packageVehicles: Veh[]; packageRows: RRow[];
}) {
  const [tab, setTab] = useState<"routes" | "packages">("routes");
  const hasPackages = packageRows.length > 0;

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
        {([["routes", "Routes"], ...(hasPackages ? [["packages", "Packages"]] : [])] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === k ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      {tab === "routes"
        ? <Matrix vehicles={routeVehicles} rows={routeRows} firstCol="Route" />
        : <Matrix vehicles={packageVehicles} rows={packageRows} firstCol="Package" />}
    </div>
  );
}
