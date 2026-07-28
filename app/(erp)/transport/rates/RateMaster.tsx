"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

interface Ref { id: string; name: string }
interface AgentRef { id: string; agency_name: string }
interface AgentRate { id: string; agent_id: string | null; route_id: string; vehicle_id: string; effective_from: string; effective_to: string | null; selling_rate: number; status: string }
interface VendorRate { id: string; vendor_id: string; route_id: string; vehicle_id: string; effective_from: string; effective_to: string | null; purchase_rate: number; status: string }

const today = () => new Date().toISOString().slice(0, 10);

export default function RateMaster({ routes, vehicles, agents, vendors, agentRates, vendorRates }: {
  routes: Ref[]; vehicles: Ref[]; agents: AgentRef[]; vendors: Ref[]; agentRates: AgentRate[]; vendorRates: VendorRate[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [tab, setTab] = useState<"agent" | "vendor">("agent");
  const rName = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes]);
  const vName = useMemo(() => new Map(vehicles.map((v) => [v.id, v.name])), [vehicles]);
  const aName = useMemo(() => new Map(agents.map((a) => [a.id, a.agency_name])), [agents]);
  const venName = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors]);

  const [af, setAf] = useState({ agent_id: "", route_id: "", vehicle_id: "", effective_from: today(), effective_to: "", selling_rate: "" });
  const [vf, setVf] = useState({ vendor_id: "", route_id: "", vehicle_id: "", effective_from: today(), effective_to: "", purchase_rate: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
        {(["agent", "vendor"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
            {k === "agent" ? "Agent Rates (Selling)" : "Vendor Rates (Purchase)"}
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
      ) : (
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
      )}
    </div>
  );
}
