"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Route { id: string; name: string }
interface Vehicle { id: string; name: string }
interface Leg { id: string; seq: number; route_id: string | null; label: string | null; vehicle_id: string | null }

// Ordered legs of a package. A leg is either a fixed route or a free-text label
// (e.g. "Makkah Ziyarat"), optionally with a specific vehicle.
export default function PackageBuilder({ packageId, initial, routes, vehicles }: {
  packageId: string; initial: Leg[]; routes: Route[]; vehicles: Vehicle[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const rName = new Map(routes.map((r) => [r.id, r.name]));
  const vName = new Map(vehicles.map((v) => [v.id, v.name]));
  const [routeId, setRouteId] = useState("");
  const [label, setLabel] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addLeg(e: React.FormEvent) {
    e.preventDefault();
    if (!routeId && !label.trim()) { setErr("Pick a route or type a label."); return; }
    setBusy(true); setErr(null);
    const nextSeq = (initial.reduce((m, l) => Math.max(m, l.seq), 0) || 0) + 1;
    const { error } = await supabase.from("transport_package_legs").insert({
      company_id: COMPANY_ID, package_id: packageId, seq: nextSeq,
      route_id: routeId || null, label: label.trim() || null, vehicle_id: vehicleId || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setRouteId(""); setLabel(""); setVehicleId("");
    router.refresh();
  }

  async function move(leg: Leg, dir: -1 | 1) {
    const sorted = [...initial].sort((a, b) => a.seq - b.seq);
    const idx = sorted.findIndex((l) => l.id === leg.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    await Promise.all([
      supabase.from("transport_package_legs").update({ seq: swap.seq }).eq("id", leg.id),
      supabase.from("transport_package_legs").update({ seq: leg.seq }).eq("id", swap.id),
    ]);
    router.refresh();
  }

  async function del(leg: Leg) {
    await supabase.from("transport_package_legs").delete().eq("id", leg.id);
    router.refresh();
  }

  const legs = [...initial].sort((a, b) => a.seq - b.seq);

  return (
    <div className="space-y-4">
      <form onSubmit={addLeg} className="card grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-1"><label className="label">Route</label>
          <select className="input" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            <option value="">— custom —</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></div>
        <div className="sm:col-span-1"><label className="label">Or custom label</label>
          <input className="input" placeholder="Makkah Ziyarat" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div className="sm:col-span-1"><label className="label">Vehicle (optional)</label>
          <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">— package default —</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></div>
        <div className="flex items-end sm:col-span-1"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add trip"}</button></div>
        {err && <p className="text-sm text-red-600 sm:col-span-4">{err}</p>}
      </form>

      <ol className="card space-y-2 p-4">
        {legs.map((l, i) => (
          <li key={l.id} className="flex items-center gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{i + 1}</span>
            <span className="flex-1 text-sm">
              {l.route_id ? (rName.get(l.route_id) ?? "Route") : l.label}
              {l.vehicle_id && <span className="ml-2 text-xs text-slate-400">{vName.get(l.vehicle_id)}</span>}
            </span>
            <button onClick={() => move(l, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30">↑</button>
            <button onClick={() => move(l, 1)} disabled={i === legs.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30">↓</button>
            <button onClick={() => del(l)} className="text-sm text-red-600 hover:underline">Remove</button>
          </li>
        ))}
        {legs.length === 0 && <li className="text-sm text-slate-400">No trips added yet.</li>}
      </ol>
    </div>
  );
}
