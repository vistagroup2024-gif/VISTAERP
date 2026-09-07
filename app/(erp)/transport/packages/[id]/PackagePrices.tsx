"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import MultiSelectFilter from "@/components/MultiSelectFilter";

interface Vehicle { id: string; name: string; category: string | null; is_active: boolean }
interface Price { id: string; vehicle_id: string; price: number; agent_id: string | null }
interface Agent { id: string; agency_name: string }
// What the package's legs cost booked individually, per vehicle. `priced` against
// `legs` says whether the total covers the whole package or only the part of it
// that has a rate — a total missing a leg is not a total.
interface LegTotal { total: number; priced: number; legs: number }

// Package price per vehicle. Standard price (no agents selected) plus optional
// agent-specific overrides. Selecting several agents saves the same price to all
// of them at once. Saved via the set_package_price RPC.
export default function PackagePrices({ packageId, vehicles, initial, agents }: {
  packageId: string; vehicles: Vehicle[]; initial: Price[]; agents: Agent[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [agentIds, setAgentIds] = useState<string[]>([]); // [] = Standard
  const multi = agentIds.length > 1;

  const forAgent = (aid: string) => new Map(initial.filter((p) => (p.agent_id ?? "") === aid).map((p) => [p.vehicle_id, p]));
  const standard = useMemo(() => forAgent(""), [initial]);
  const overriddenAgentIds = useMemo(() => new Set(initial.filter((p) => p.agent_id).map((p) => p.agent_id)), [initial]);
  // Seed inputs from the single selected context; blank when editing many agents.
  const seed = useMemo(() => (agentIds.length <= 1 ? forAgent(agentIds[0] ?? "") : new Map()), [initial, agentIds]);

  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    setVals(Object.fromEntries(vehicles.map((v) => [v.id, (seed.get(v.id) as any)?.price?.toString() ?? ""])));
  }, [agentIds, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // The suggested fare: what these same trips cost booked leg by leg, so the
  // discount is visible while the package price is being typed rather than
  // worked out on paper from the Rate Master.
  const [legTotals, setLegTotals] = useState<Record<string, LegTotal>>({});
  const [legNames, setLegNames] = useState<string[]>([]);
  // Follows the pricing context: one agent selected means their route rates.
  // Several at once have different rates from each other, so it falls back to
  // the standard ones and says so.
  const rateAgent = agentIds.length === 1 ? agentIds[0] : null;
  useEffect(() => {
    let live = true;
    supabase.rpc("transport_package_route_total", { p_package: packageId, p_agent: rateAgent })
      .then(({ data }) => {
        if (!live) return;
        const d: any = data ?? {};
        setLegTotals((d.vehicles ?? {}) as Record<string, LegTotal>);
        setLegNames(((d.legs ?? []) as any[]).map((l) => l.label).filter(Boolean));
      });
    return () => { live = false; };
  }, [packageId, rateAgent, supabase]);

  const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  const targets = (): (string | null)[] => (agentIds.length ? agentIds : [null]);

  async function saveOne(vehicleId: string, raw: string) {
    const price = raw === "" || raw == null ? null : Number(raw);
    for (const aid of targets()) {
      const { error } = await supabase.rpc("set_package_price", { p_package: packageId, p_vehicle: vehicleId, p_agent: aid, p_price: price });
      if (error) throw new Error(error.message);
    }
  }

  async function save(vehicleId: string) {
    setBusy(vehicleId); setErr(null); setMsg(null);
    try { await saveOne(vehicleId, vals[vehicleId]); router.refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  async function saveAll() {
    setBusy("__all__"); setErr(null); setMsg(null);
    try {
      const rows = vehicles.filter((v) => (vals[v.id] ?? "") !== "");
      for (const v of rows) await saveOne(v.id, vals[v.id]);
      const who = agentIds.length ? `${agentIds.length} agent(s)` : "Standard";
      setMsg(`Saved ${rows.length} price(s) for ${who}.`);
      router.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600">Pricing for</label>
        <MultiSelectFilter label="Standard (all agents)"
          options={agents.map((a) => ({ value: a.id, label: `${a.agency_name}${overriddenAgentIds.has(a.id) ? " ✱" : ""}` }))}
          selected={agentIds} onChange={setAgentIds} />
        <span className="text-sm text-slate-500">
          {agentIds.length === 0 ? "Editing the Standard price" : multi ? `Saving to ${agentIds.length} agents together` : "Editing 1 agent"}
        </span>
        {agentIds.length > 0 && <span className="text-xs text-slate-400">✱ = has custom prices · blank field falls back to Standard</span>}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {multi && <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">Enter the price(s) below and Save — the same value is written for every selected agent. Existing per-agent prices aren&rsquo;t shown while multiple agents are selected.</p>}
      {/* Say what is being added up and whose rates, or the number is just a
          number somebody has to trust. */}
      {legNames.length > 0 && (
        <p className="text-xs text-slate-500">
          <b>If booked separately</b> adds up this package&rsquo;s {legNames.length} leg{legNames.length === 1 ? "" : "s"} at the
          {multi ? " Standard " : agentIds.length === 1 ? " selected agent\u2019s " : " Standard "}
          route rates in force today: {legNames.join(" + ")}.
          {multi && " Agents priced differently from each other, so the comparison uses the Standard rates."}
        </p>
      )}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Vehicle</th>{agentIds.length > 0 && <th className="th">Standard</th>}<th className="th">Package price (SAR)</th><th className="th">If booked separately</th><th className="th">Package saves</th><th className="th"></th></tr></thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="td font-medium">{v.name}{v.category ? <span className="ml-2 text-xs text-slate-400">{v.category}</span> : null}{!v.is_active && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}</td>
                {agentIds.length > 0 && <td className="td text-slate-400">{(standard.get(v.id) as any)?.price != null ? Number((standard.get(v.id) as any).price).toFixed(2) : "—"}</td>}
                <td className="td"><input className="input max-w-[10rem]" type="number" min="0" step="0.01"
                  placeholder={agentIds.length > 0 && (standard.get(v.id) as any)?.price != null ? `${Number((standard.get(v.id) as any).price).toFixed(2)} (standard)` : "—"}
                  value={vals[v.id] ?? ""} onChange={(e) => setVals({ ...vals, [v.id]: e.target.value })} /></td>
                {(() => {
                  const lt = legTotals[v.id];
                  const sum = lt && lt.priced > 0 ? Number(lt.total) : null;
                  const partial = !!lt && lt.priced < lt.legs;
                  // Read from the input, not from what is saved: the whole point
                  // is to see the gap while the number is being decided.
                  const typed = (vals[v.id] ?? "") === "" ? null : Number(vals[v.id]);
                  const diff = sum != null && typed != null ? sum - typed : null;
                  return (
                    <>
                      <td className="td tabular-nums text-slate-600">
                        {sum != null ? money(sum) : "—"}
                        {partial && <span className="ml-1 text-xs text-amber-600" title={`Only ${lt.priced} of ${lt.legs} legs have a rate for this vehicle`}>({lt.priced}/{lt.legs} legs)</span>}
                      </td>
                      <td className="td tabular-nums">
                        {diff == null ? <span className="text-slate-300">—</span>
                          : diff > 0 ? <span className="font-semibold text-green-700">{money(diff)} <span className="text-xs font-normal">({Math.round((diff / sum!) * 100)}%)</span></span>
                          : diff === 0 ? <span className="text-slate-500">same price</span>
                          : <span className="font-semibold text-red-600" title="The package costs more than booking the legs separately">+{money(-diff)} dearer</span>}
                      </td>
                    </>
                  );
                })()}
                <td className="td"><button onClick={() => save(v.id)} disabled={!!busy} className="text-sm font-medium text-brand hover:underline">{busy === v.id ? "…" : "Save"}</button></td>
              </tr>
            ))}
            {vehicles.length === 0 && <tr><td className="td text-slate-400" colSpan={agentIds.length > 0 ? 6 : 5}>Add vehicles first.</td></tr>}
          </tbody>
        </table>
      </div>
      {vehicles.length > 0 && (
        <button onClick={saveAll} disabled={!!busy} className="btn text-sm">{busy === "__all__" ? "Saving…" : "💾 Save all rows"}</button>
      )}
    </div>
  );
}
