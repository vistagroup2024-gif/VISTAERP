"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Vehicle { id: string; name: string; category: string | null; is_active: boolean }
interface Rate { id: string; vehicle_id: string; sell_rate: number; currency: string; is_active: boolean }

// One editable rate row per vehicle. Each vehicle has at most one rate on the route
// (enforced by the unique constraint); we upsert on the (route, vehicle) pair.
export default function RouteRatesManager({ routeId, vehicles, initial }: { routeId: string; vehicles: Vehicle[]; initial: Rate[] }) {
  const router = useRouter();
  const supabase = createClient();
  const byVehicle = new Map(initial.map((r) => [r.vehicle_id, r]));
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(vehicles.map((v) => [v.id, byVehicle.get(v.id)?.sell_rate?.toString() ?? ""]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function saveRate(vehicleId: string) {
    setBusy(vehicleId); setErr(null);
    const raw = vals[vehicleId];
    const existing = byVehicle.get(vehicleId);
    if (raw === "" || raw == null) {
      if (existing) await supabase.from("transport_route_rates").delete().eq("id", existing.id);
    } else {
      const { error } = await supabase.from("transport_route_rates").upsert(
        { company_id: COMPANY_ID, route_id: routeId, vehicle_id: vehicleId, sell_rate: Number(raw) },
        { onConflict: "route_id,vehicle_id" }
      );
      if (error) { setBusy(null); return setErr(error.message); }
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr><th className="th">Vehicle</th><th className="th">Selling rate (SAR)</th><th className="th">Actions</th></tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="td font-medium">{v.name}{v.category ? <span className="ml-2 text-xs text-slate-400">{v.category}</span> : null}{!v.is_active && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}</td>
                <td className="td">
                  <input className="input max-w-[10rem]" type="number" min="0" step="0.01" placeholder="—"
                    value={vals[v.id] ?? ""} onChange={(e) => setVals({ ...vals, [v.id]: e.target.value })} />
                </td>
                <td className="td">
                  <button onClick={() => saveRate(v.id)} disabled={busy === v.id} className="text-sm font-medium text-brand hover:underline disabled:opacity-40">
                    {busy === v.id ? "…" : "Save"}
                  </button>
                </td>
              </tr>
            ))}
            {vehicles.length === 0 && <tr><td className="td text-slate-400" colSpan={3}>Add vehicles first.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Leave a rate blank and press Save to remove that vehicle’s rate on this route.</p>
    </div>
  );
}
