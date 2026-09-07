"use client";

import { useEffect, useMemo, useState } from "react";

const todayStr = () => new Date().toISOString().slice(0, 10);
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import MultiSelectFilter from "@/components/MultiSelectFilter";

interface Vehicle { id: string; name: string; category: string | null; is_active: boolean }
interface Price { id: string; vehicle_id: string; price: number; agent_id: string | null; effective_from: string; effective_to: string | null; status: string | null }
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

  // The date the prices being edited start on. Everything below is read and
  // written as of this date, the way the route Bulk Update already works.
  const [effFrom, setEffFrom] = useState(todayStr());

  // Which row is in force for a vehicle on a date. Mirrors transport_package_price():
  // the agent's own price wins over the standard one, and within that the latest
  // one that has started.
  const inForce = (vehicleId: string, aid: string | null, on: string) => {
    const live = initial.filter((p) =>
      p.vehicle_id === vehicleId && (p.status ?? "active") === "active" &&
      p.effective_from <= on && (!p.effective_to || p.effective_to >= on));
    const pick = (rows: Price[]) => rows.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
    return pick(live.filter((p) => p.agent_id === aid)) ?? (aid ? pick(live.filter((p) => !p.agent_id)) : undefined);
  };

  const overriddenAgentIds = useMemo(() => new Set(initial.filter((p) => p.agent_id).map((p) => p.agent_id)), [initial]);

  // A row already written FOR this exact effective date is an edit of it; one
  // inherited from an earlier date is not, so the field starts blank and the
  // placeholder shows what it would otherwise fall back to.
  const exact = (vehicleId: string, aid: string | null) =>
    initial.find((p) => p.vehicle_id === vehicleId && p.agent_id === aid && p.effective_from === effFrom);

  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    const aid = agentIds.length === 1 ? agentIds[0] : agentIds.length === 0 ? null : undefined;
    setVals(Object.fromEntries(vehicles.map((v) =>
      [v.id, aid === undefined ? "" : (exact(v.id, aid)?.price?.toString() ?? "")])));
  }, [agentIds, initial, effFrom]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const { error } = await supabase.rpc("set_package_price", { p_package: packageId, p_vehicle: vehicleId, p_agent: aid, p_price: price, p_from: effFrom });
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
      setMsg(`Saved ${rows.length} price(s) for ${who}, effective ${effFrom}.`);
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

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-600">Effective from</label>
        <input type="date" className="input max-w-[10rem]" value={effFrom}
          onChange={(e) => setEffFrom(e.target.value || todayStr())} />
        <span className="text-xs text-slate-400">
          Saving writes prices starting on this date. Earlier prices stay as they are, so next season can be entered now.
        </span>

        {/* Copy a whole list rather than retyping it: pick who to copy from, the
            fields fill with THEIR prices in force on the date above, and nothing
            is written until Save — so it can be adjusted first. */}
        <label className="ml-auto text-sm text-slate-600">Copy prices from</label>
        <select className="input max-w-[14rem]" value=""
          onChange={(e) => {
            const src = e.target.value === "__std__" ? null : e.target.value || null;
            if (e.target.value === "") return;
            setVals(Object.fromEntries(vehicles.map((v) => {
              const row = inForce(v.id, src, effFrom);
              return [v.id, row ? String(row.price) : ""];
            })));
            setMsg(`Copied ${e.target.value === "__std__" ? "Standard" : agents.find((a) => a.id === src)?.agency_name ?? ""} prices into the fields — review, then Save.`);
            e.target.value = "";
          }}>
          <option value="">Choose…</option>
          <option value="__std__">Standard (all agents)</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.agency_name}{overriddenAgentIds.has(a.id) ? " ✱" : ""}</option>)}
        </select>
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
                {agentIds.length > 0 && <td className="td text-slate-400">{inForce(v.id, null, effFrom)?.price != null ? Number(inForce(v.id, null, effFrom)!.price).toFixed(2) : "—"}</td>}
                <td className="td"><input className="input max-w-[10rem]" type="number" min="0" step="0.01"
                  placeholder={(() => {
                    const cur = inForce(v.id, agentIds.length === 1 ? agentIds[0] : null, effFrom);
                    return cur ? `${Number(cur.price).toFixed(2)} in force${cur.effective_from !== effFrom ? ` from ${cur.effective_from}` : ""}` : "—";
                  })()}
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
