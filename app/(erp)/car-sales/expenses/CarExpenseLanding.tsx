"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SearchSelect from "@/components/ui/SearchSelect";
import { sar } from "../lib";
import { dateStr } from "@/lib/format";

type VehicleOpt = {
  kind: "vehicle" | "po_line"; id: string | null; po_line: string | null;
  label: string; cost: number; status: string; grp: string;
};
type Summary = {
  vehicle_id: string; label: string; status: string; cost: number;
  count: number; total: number; last_date: string;
};

// The picker holds one value for two kinds of thing, so the key says which:
// "v:<id>" is a car in the yard, "p:<line>" is one still on a purchase order.
// The vehicle's own sheet is keyed the same way, so opening either list lands
// on the same route.
const keyOf = (v: VehicleOpt) => (v.kind === "vehicle" ? `v:${v.id}` : `p:${v.po_line}`);

export default function CarExpenseLanding({ vehicles, summary, rights }: {
  vehicles: VehicleOpt[]; summary: Summary[]; rights: Record<string, boolean>;
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");

  const groups = useMemo(() => {
    const m = new Map<string, VehicleOpt[]>();
    for (const v of vehicles) { if (!m.has(v.grp)) m.set(v.grp, []); m.get(v.grp)!.push(v); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [vehicles]);

  function open(key: string) {
    if (!key) return;
    router.push(`/car-sales/expenses/${encodeURIComponent(key)}`);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Car Expense</h1>
        <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand">car sales</span>
      </div>
      <p className="text-sm text-slate-500">
        A cost that lands on a vehicle after it is bought — registration, insurance, transport, customs.
        Each one capitalises into Vehicle Inventory and adds to that car&apos;s Total Cost, which is what
        the quotation quotes its margin on. One sheet per car: open a vehicle below and every expense on
        it — however many, whenever they land — goes on the same sheet.
      </p>

      {rights.create && (
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Start a vehicle&apos;s expense sheet</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[20rem] flex-1">
              <SearchSelect value={pick} onChange={setPick}
                placeholder="Choose a vehicle…"
                options={groups.flatMap(([g, list]) =>
                  list.map((v) => ({ value: keyOf(v), label: v.label, group: g.replace(/^\d\s/, "") })))} />
              <p className="mt-1 text-xs text-slate-500">
                Cars in the yard, and cars still on a purchase order — customs and transport are billed
                long before the car turns up. A vehicle with expenses already on it is not offered here —
                open it from the list below instead.
              </p>
            </div>
            <button type="button" className="btn disabled:opacity-40" disabled={!pick} onClick={() => open(pick)}>
              Open sheet
            </button>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800">Vehicles with expenses</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="th">Vehicle</th><th className="th text-right">Lines</th>
              <th className="th text-right">Total</th><th className="th">Last expense</th>
              <th className="th text-right">Total cost</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.vehicle_id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => open(`v:${s.vehicle_id}`)}>
                  <td className="td">{s.label}</td>
                  <td className="td text-right tabular-nums">{s.count}</td>
                  <td className="td text-right tabular-nums">{sar(s.total)}</td>
                  <td className="td">{dateStr(s.last_date)}</td>
                  <td className="td text-right tabular-nums">{sar(s.cost)}</td>
                  <td className="td text-right">
                    <button type="button" className="text-brand hover:underline" onClick={(e) => { e.stopPropagation(); open(`v:${s.vehicle_id}`); }}>
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
              {summary.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No car expenses yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
