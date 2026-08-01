"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Ref { id: string; name: string }
interface AgentRef { id: string; agency_name: string }
interface AgentRate { id: string; agent_id: string | null; route_id: string; vehicle_id: string; effective_from: string; effective_to: string | null; selling_rate: number; status: string }
interface VendorRate { id: string; vendor_id: string; route_id: string; vehicle_id: string; effective_from: string; effective_to: string | null; purchase_rate: number; status: string }
interface RouteRate { id: string; route_id: string; vehicle_id: string; extra_charge_enabled: boolean; extra_charge_desc: string | null; extra_charge_amount: number }

const today = () => new Date().toISOString().slice(0, 10);

export default function RateMaster({ routes, vehicles, agents, vendors, agentRates, vendorRates, routeRates = [] }: {
  routes: Ref[]; vehicles: Ref[]; agents: AgentRef[]; vendors: Ref[]; agentRates: AgentRate[]; vendorRates: VendorRate[]; routeRates?: RouteRate[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [tab, setTab] = useState<"agent" | "vendor" | "bulk" | "extras">("agent");

  // Route extra-charge form (e.g. Hajj Terminal), stored on transport_route_rates.
  const [xf, setXf] = useState({ route_id: "", vehicle_id: "", extra_charge_desc: "", extra_charge_amount: "" });
  async function saveExtra(e: React.FormEvent) {
    e.preventDefault();
    if (!xf.route_id || !xf.vehicle_id || !xf.extra_charge_amount) { setErr("Route, vehicle and amount are required."); return; }
    setBusy(true); setErr(null);
    const existing = routeRates.find((r) => r.route_id === xf.route_id && r.vehicle_id === xf.vehicle_id);
    const patch = { extra_charge_enabled: true, extra_charge_desc: xf.extra_charge_desc.trim() || "Hajj Terminal", extra_charge_amount: Number(xf.extra_charge_amount) };
    const { error } = existing
      ? await supabase.from("transport_route_rates").update(patch).eq("id", existing.id)
      : await supabase.from("transport_route_rates").insert({ company_id: COMPANY_ID, route_id: xf.route_id, vehicle_id: xf.vehicle_id, sell_rate: 0, ...patch });
    setBusy(false);
    if (error) return setErr(error.message);
    setXf({ route_id: "", vehicle_id: "", extra_charge_desc: "", extra_charge_amount: "" });
    router.refresh();
  }
  async function disableExtra(id: string) {
    await supabase.from("transport_route_rates").update({ extra_charge_enabled: false }).eq("id", id);
    router.refresh();
  }
  const todayS = today();
  const rName = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes]);
  const vName = useMemo(() => new Map(vehicles.map((v) => [v.id, v.name])), [vehicles]);
  const aName = useMemo(() => new Map(agents.map((a) => [a.id, a.agency_name])), [agents]);
  const venName = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors]);

  const [af, setAf] = useState({ agent_id: "", route_id: "", vehicle_id: "", effective_from: today(), effective_to: "", selling_rate: "" });
  const [vf, setVf] = useState({ vendor_id: "", route_id: "", vehicle_id: "", effective_from: today(), effective_to: "", purchase_rate: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Bulk update state.
  const [bKind, setBKind] = useState<"vendor" | "agent_default" | "agent_custom">("agent_default");
  const [bVendor, setBVendor] = useState("");
  // Agent — Specific bulk update supports selecting many agents at once, so a
  // differentiated rate set can be applied to several agents in one save.
  const [bAgents, setBAgents] = useState<string[]>([]);
  const toggleBAgent = (id: string) => setBAgents((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const [bVehicle, setBVehicle] = useState("");
  const [bDate, setBDate] = useState(today());
  const [bNew, setBNew] = useState<Record<string, string>>({});
  const [bMsg, setBMsg] = useState<string | null>(null);

  const byFromDesc = (a: any, b: any) => (a.effective_from < b.effective_from ? 1 : -1);
  const effective = (r: any) => r.status === "active" && r.effective_from <= todayS && (!r.effective_to || r.effective_to >= todayS);

  function currentAgentRate(routeId: string, vehicleId: string, agentId: string | null) {
    const pool = agentRates.filter((r) => effective(r) && r.route_id === routeId && r.vehicle_id === vehicleId);
    let cand = agentId ? pool.filter((r) => r.agent_id === agentId).sort(byFromDesc) : [];
    if (cand.length === 0) cand = pool.filter((r) => r.agent_id === null).sort(byFromDesc);
    return cand[0]?.selling_rate ?? null;
  }
  function currentVendorRate(routeId: string, vehicleId: string, vendorId: string) {
    const cand = vendorRates.filter((r) => effective(r) && r.route_id === routeId && r.vehicle_id === vehicleId && r.vendor_id === vendorId).sort(byFromDesc);
    return cand[0]?.purchase_rate ?? null;
  }

  async function saveBulk() {
    if (!bVehicle) { setErr("Select a vehicle."); return; }
    if (bKind === "vendor" && !bVendor) { setErr("Select a vendor."); return; }
    if (bKind === "agent_custom" && bAgents.length === 0) { setErr("Select at least one agent."); return; }
    const entries = routes.filter((r) => bNew[r.id] !== undefined && bNew[r.id] !== "");
    if (entries.length === 0) { setErr("Enter at least one new rate."); return; }
    setBusy(true); setErr(null); setBMsg(null);
    let error;
    if (bKind === "vendor") {
      ({ error } = await supabase.from("transport_vendor_rates").insert(entries.map((r) => ({
        company_id: COMPANY_ID, vendor_id: bVendor, route_id: r.id, vehicle_id: bVehicle,
        effective_from: bDate, purchase_rate: Number(bNew[r.id]),
      }))));
    } else {
      // Default → one null-agent set. Specific → one set per selected agent.
      const targets: (string | null)[] = bKind === "agent_custom" ? bAgents : [null];
      const rows = targets.flatMap((ag) => entries.map((r) => ({
        company_id: COMPANY_ID, agent_id: ag, route_id: r.id, vehicle_id: bVehicle,
        effective_from: bDate, selling_rate: Number(bNew[r.id]),
      })));
      ({ error } = await supabase.from("transport_agent_rates").insert(rows));
    }
    setBusy(false);
    if (error) return setErr(error.message);
    const agentNote = bKind === "agent_custom" ? ` for ${bAgents.length} agent(s)` : "";
    setBNew({}); setBMsg(`Saved ${entries.length} new rate(s)${agentNote} effective ${bDate}.`);
    router.refresh();
  }

  async function addAgentRate(e: React.FormEvent) {
    e.preventDefault();
    if (!af.route_id || !af.vehicle_id || !af.selling_rate) { setErr("Route, vehicle and rate are required."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_agent_rates").insert({
      company_id: COMPANY_ID, agent_id: af.agent_id || null, route_id: af.route_id, vehicle_id: af.vehicle_id,
      effective_from: af.effective_from, effective_to: af.effective_to || null, selling_rate: Number(af.selling_rate),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setAf({ ...af, selling_rate: "" });
    router.refresh();
  }

  async function addVendorRate(e: React.FormEvent) {
    e.preventDefault();
    if (!vf.vendor_id || !vf.route_id || !vf.vehicle_id || !vf.purchase_rate) { setErr("Vendor, route, vehicle and rate are required."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from("transport_vendor_rates").insert({
      company_id: COMPANY_ID, vendor_id: vf.vendor_id, route_id: vf.route_id, vehicle_id: vf.vehicle_id,
      effective_from: vf.effective_from, effective_to: vf.effective_to || null, purchase_rate: Number(vf.purchase_rate),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setVf({ ...vf, purchase_rate: "" });
    router.refresh();
  }

  async function toggleStatus(table: string, id: string, status: string) {
    await supabase.from(table).update({ status: status === "active" ? "inactive" : "active" }).eq("id", id);
    router.refresh();
  }
  async function del(table: string, id: string) {
    if (!confirm("Delete this rate record?")) return;
    await supabase.from(table).delete().eq("id", id);
    router.refresh();
  }

  const Status = ({ s }: { s: string }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s === "active" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>{s}</span>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["agent", "vendor", "bulk", "extras"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
            {k === "agent" ? "Agent Rates (Selling)" : k === "vendor" ? "Vendor Rates (Purchase)" : k === "bulk" ? "⚡ Bulk Update" : "Route Extras"}
          </button>
        ))}
      </div>
      {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {tab === "agent" ? (
        <>
          <form onSubmit={addAgentRate} className="card grid grid-cols-1 gap-3 sm:grid-cols-7">
            <div><label className="label">Agent</label>
              <select className="input" value={af.agent_id} onChange={(e) => setAf({ ...af, agent_id: e.target.value })}>
                <option value="">Default / Direct</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.agency_name}</option>)}
              </select></div>
            <div><label className="label">Route *</label><select className="input" value={af.route_id} onChange={(e) => setAf({ ...af, route_id: e.target.value })}><option value="">—</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <div><label className="label">Vehicle *</label><select className="input" value={af.vehicle_id} onChange={(e) => setAf({ ...af, vehicle_id: e.target.value })}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className="label">Effective from</label><input className="input" type="date" value={af.effective_from} onChange={(e) => setAf({ ...af, effective_from: e.target.value })} /></div>
            <div><label className="label">Effective to</label><input className="input" type="date" value={af.effective_to} onChange={(e) => setAf({ ...af, effective_to: e.target.value })} /></div>
            <div><label className="label">Selling rate *</label><input className="input" type="number" min="0" step="0.01" value={af.selling_rate} onChange={(e) => setAf({ ...af, selling_rate: e.target.value })} /></div>
            <div className="flex items-end"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add"}</button></div>
          </form>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Agent</th><th className="th">Route</th><th className="th">Vehicle</th><th className="th">From</th><th className="th">To</th><th className="th">Rate</th><th className="th">Status</th><th className="th"></th></tr></thead>
              <tbody>
                {agentRates.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="td">{r.agent_id ? aName.get(r.agent_id) ?? "—" : "Default"}</td>
                    <td className="td">{rName.get(r.route_id) ?? "—"}</td>
                    <td className="td">{vName.get(r.vehicle_id) ?? "—"}</td>
                    <td className="td">{r.effective_from}</td>
                    <td className="td">{r.effective_to ?? "—"}</td>
                    <td className="td">{Number(r.selling_rate).toFixed(2)}</td>
                    <td className="td"><button onClick={() => toggleStatus("transport_agent_rates", r.id, r.status)}><Status s={r.status} /></button></td>
                    <td className="td"><button onClick={() => del("transport_agent_rates", r.id)} className="text-sm text-red-600 hover:underline">Delete</button></td>
                  </tr>
                ))}
                {agentRates.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No agent rates yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : tab === "vendor" ? (
        <>
          <form onSubmit={addVendorRate} className="card grid grid-cols-1 gap-3 sm:grid-cols-7">
            <div><label className="label">Vendor *</label><select className="input" value={vf.vendor_id} onChange={(e) => setVf({ ...vf, vendor_id: e.target.value })}><option value="">—</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className="label">Route *</label><select className="input" value={vf.route_id} onChange={(e) => setVf({ ...vf, route_id: e.target.value })}><option value="">—</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <div><label className="label">Vehicle *</label><select className="input" value={vf.vehicle_id} onChange={(e) => setVf({ ...vf, vehicle_id: e.target.value })}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className="label">Effective from</label><input className="input" type="date" value={vf.effective_from} onChange={(e) => setVf({ ...vf, effective_from: e.target.value })} /></div>
            <div><label className="label">Effective to</label><input className="input" type="date" value={vf.effective_to} onChange={(e) => setVf({ ...vf, effective_to: e.target.value })} /></div>
            <div><label className="label">Purchase rate *</label><input className="input" type="number" min="0" step="0.01" value={vf.purchase_rate} onChange={(e) => setVf({ ...vf, purchase_rate: e.target.value })} /></div>
            <div className="flex items-end"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add"}</button></div>
          </form>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Vendor</th><th className="th">Route</th><th className="th">Vehicle</th><th className="th">From</th><th className="th">To</th><th className="th">Rate</th><th className="th">Status</th><th className="th"></th></tr></thead>
              <tbody>
                {vendorRates.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="td">{venName.get(r.vendor_id) ?? "—"}</td>
                    <td className="td">{rName.get(r.route_id) ?? "—"}</td>
                    <td className="td">{vName.get(r.vehicle_id) ?? "—"}</td>
                    <td className="td">{r.effective_from}</td>
                    <td className="td">{r.effective_to ?? "—"}</td>
                    <td className="td">{Number(r.purchase_rate).toFixed(2)}</td>
                    <td className="td"><button onClick={() => toggleStatus("transport_vendor_rates", r.id, r.status)}><Status s={r.status} /></button></td>
                    <td className="td"><button onClick={() => del("transport_vendor_rates", r.id)} className="text-sm text-red-600 hover:underline">Delete</button></td>
                  </tr>
                ))}
                {vendorRates.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No vendor rates yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : tab === "bulk" ? (
        <>
          <div className="card grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div><label className="label">Rate set</label>
              <select className="input" value={bKind} onChange={(e) => setBKind(e.target.value as any)}>
                <option value="agent_default">Agent — Default (all standard agents)</option>
                <option value="agent_custom">Agent — Specific (override)</option>
                <option value="vendor">Vendor (purchase)</option>
              </select></div>
            {bKind === "vendor" && <div><label className="label">Vendor *</label>
              <select className="input" value={bVendor} onChange={(e) => setBVendor(e.target.value)}><option value="">—</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>}
            <div><label className="label">Vehicle *</label>
              <select className="input" value={bVehicle} onChange={(e) => setBVehicle(e.target.value)}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className="label">Effective from</label><input className="input" type="date" value={bDate} onChange={(e) => setBDate(e.target.value)} /></div>
          </div>

          {bKind === "agent_custom" && (
            <div className="card space-y-2">
              <div className="flex items-center justify-between">
                <label className="label mb-0">Agents * <span className="font-normal text-slate-400">({bAgents.length} selected)</span></label>
                <div className="flex gap-3 text-xs">
                  <button type="button" className="text-brand hover:underline" onClick={() => setBAgents(agents.map((a) => a.id))}>Select all</button>
                  <button type="button" className="text-slate-500 hover:underline" onClick={() => setBAgents([])}>Clear</button>
                </div>
              </div>
              <p className="text-xs text-slate-500">Tick every agent that shares this differentiated rate — the same rates are applied to all of them in one save.</p>
              <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {agents.map((a) => (
                  <label key={a.id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${bAgents.includes(a.id) ? "border-brand bg-brand/5" : "border-slate-200"}`}>
                    <input type="checkbox" checked={bAgents.includes(a.id)} onChange={() => toggleBAgent(a.id)} />
                    <span className="truncate">{a.agency_name}</span>
                  </label>
                ))}
                {agents.length === 0 && <span className="text-sm text-slate-400">No agents available.</span>}
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500">Enter only the routes that change. Blank rows keep their existing rate. Saving creates a new effective-dated set — history is preserved.</p>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Route</th><th className="th">Current rate</th><th className="th">New rate</th></tr></thead>
              <tbody>
                {bVehicle ? routes.map((r) => {
                  const cur = bKind === "vendor"
                    ? currentVendorRate(r.id, bVehicle, bVendor)
                    : currentAgentRate(r.id, bVehicle, bKind === "agent_custom" && bAgents.length === 1 ? bAgents[0] : null);
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="td font-medium">{r.name}</td>
                      <td className="td text-slate-500">{cur != null ? Number(cur).toFixed(2) : "—"}</td>
                      <td className="td"><input className="input max-w-[9rem]" type="number" min="0" step="0.01" placeholder="—"
                        value={bNew[r.id] ?? ""} onChange={(e) => setBNew({ ...bNew, [r.id]: e.target.value })} /></td>
                    </tr>
                  );
                }) : <tr><td className="td text-slate-400" colSpan={3}>Select a vehicle to load routes.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={saveBulk} disabled={busy} className="btn">{busy ? "Saving…" : "Save new rate set"}</button>
            {bMsg && <span className="text-sm text-green-700">{bMsg}</span>}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500">Optional extra charges applied to a route + vehicle only when required (e.g. the <b>Hajj Terminal</b> surcharge for Jeddah Airport pickups). Booking staff tick “Hajj Terminal” on the trip to apply it.</p>
          <form onSubmit={saveExtra} className="card grid grid-cols-1 gap-3 sm:grid-cols-5">
            <div><label className="label">Route *</label><select className="input" value={xf.route_id} onChange={(e) => setXf({ ...xf, route_id: e.target.value })}><option value="">—</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <div><label className="label">Vehicle *</label><select className="input" value={xf.vehicle_id} onChange={(e) => setXf({ ...xf, vehicle_id: e.target.value })}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className="label">Description</label><input className="input" placeholder="Hajj Terminal" value={xf.extra_charge_desc} onChange={(e) => setXf({ ...xf, extra_charge_desc: e.target.value })} /></div>
            <div><label className="label">Amount (SAR) *</label><input className="input" type="number" min="0" step="0.01" value={xf.extra_charge_amount} onChange={(e) => setXf({ ...xf, extra_charge_amount: e.target.value })} /></div>
            <div className="flex items-end"><button className="btn w-full" disabled={busy}>{busy ? "…" : "Save extra"}</button></div>
          </form>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Route</th><th className="th">Vehicle</th><th className="th">Description</th><th className="th">Amount</th><th className="th"></th></tr></thead>
              <tbody>
                {routeRates.filter((r) => r.extra_charge_enabled).map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="td">{rName.get(r.route_id) ?? "—"}</td>
                    <td className="td">{vName.get(r.vehicle_id) ?? "—"}</td>
                    <td className="td">{r.extra_charge_desc ?? "—"}</td>
                    <td className="td">{Number(r.extra_charge_amount).toFixed(2)}</td>
                    <td className="td"><button onClick={() => disableExtra(r.id)} className="text-sm text-red-600 hover:underline">Remove</button></td>
                  </tr>
                ))}
                {routeRates.filter((r) => r.extra_charge_enabled).length === 0 && <tr><td className="td text-slate-400" colSpan={5}>No route extra charges configured.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
