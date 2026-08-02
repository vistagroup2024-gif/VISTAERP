"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Vehicle { id: string; name: string; category: string | null; is_active: boolean }
interface Price { id: string; vehicle_id: string; price: number; agent_id: string | null }
interface Agent { id: string; agency_name: string }

// Package price per vehicle. Standard price (agent = "") plus optional
// agent-specific overrides, saved via the set_package_price RPC.
export default function PackagePrices({ packageId, vehicles, initial, agents }: {
  packageId: string; vehicles: Vehicle[]; initial: Price[]; agents: Agent[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [agentId, setAgentId] = useState(""); // "" = Standard

  // Prices for the currently-selected context, and the standard price (shown as
  // a reference placeholder when editing an agent).
  const forAgent = (aid: string) => new Map(initial.filter((p) => (p.agent_id ?? "") === aid).map((p) => [p.vehicle_id, p]));
  const byVehicle = useMemo(() => forAgent(agentId), [initial, agentId]);
  const standard = useMemo(() => forAgent(""), [initial]);
  const overriddenAgentIds = useMemo(() => new Set(initial.filter((p) => p.agent_id).map((p) => p.agent_id)), [initial]);

  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    setVals(Object.fromEntries(vehicles.map((v) => [v.id, byVehicle.get(v.id)?.price?.toString() ?? ""])));
  }, [agentId, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(vehicleId: string) {
    setBusy(vehicleId); setErr(null);
    const raw = vals[vehicleId];
    const { error } = await supabase.rpc("set_package_price", {
      p_package: packageId, p_vehicle: vehicleId, p_agent: agentId || null,
      p_price: raw === "" || raw == null ? null : Number(raw),
    });
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600">Pricing for</label>
        <select className="input max-w-xs" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">Standard (all agents)</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.agency_name}{overriddenAgentIds.has(a.id) ? " ✱" : ""}</option>)}
        </select>
        {agentId && <span className="text-xs text-slate-400">✱ = has custom prices · blank field falls back to Standard</span>}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Vehicle</th>{agentId && <th className="th">Standard</th>}<th className="th">Package price (SAR)</th><th className="th"></th></tr></thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="td font-medium">{v.name}{v.category ? <span className="ml-2 text-xs text-slate-400">{v.category}</span> : null}{!v.is_active && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}</td>
                {agentId && <td className="td text-slate-400">{standard.get(v.id)?.price != null ? Number(standard.get(v.id)!.price).toFixed(2) : "—"}</td>}
                <td className="td"><input className="input max-w-[10rem]" type="number" min="0" step="0.01"
                  placeholder={agentId && standard.get(v.id)?.price != null ? `${Number(standard.get(v.id)!.price).toFixed(2)} (standard)` : "—"}
                  value={vals[v.id] ?? ""} onChange={(e) => setVals({ ...vals, [v.id]: e.target.value })} /></td>
                <td className="td"><button onClick={() => save(v.id)} disabled={busy === v.id} className="text-sm font-medium text-brand hover:underline">{busy === v.id ? "…" : "Save"}</button></td>
              </tr>
            ))}
            {vehicles.length === 0 && <tr><td className="td text-slate-400" colSpan={agentId ? 4 : 3}>Add vehicles first.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
