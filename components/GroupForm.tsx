"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import AirportSelect, { Airport } from "@/components/AirportSelect";
import { useUnsavedChanges, confirmDiscardIfDirty } from "@/lib/useUnsavedChanges";

export interface GroupInitial {
  id?: string;
  group_no?: string;
  group_date?: string;
  group_name?: string | null;
  pax?: number;
  agent_id?: string | null;
  group_company_id?: string | null;
  arrival_date?: string;
  arrival_flight?: string | null;
  arrival_from?: string | null;
  arrival_airport?: string | null;
  departure_date?: string;
  departure_flight?: string | null;
  departure_to?: string | null;
  departure_airport?: string | null;
  remarks?: string | null;
  visa_type?: string | null;
}

export default function GroupForm({
  airports, agents, companies, existing,
}: {
  airports: Airport[];
  agents: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  existing?: GroupInitial;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!existing?.id;

  const [f, setF] = useState({
    group_no: existing?.group_no ?? "",
    group_date: existing?.group_date ?? new Date().toISOString().slice(0, 10),
    group_name: existing?.group_name ?? "",
    pax: existing?.pax ?? 0,
    agent_id: existing?.agent_id ?? "",
    group_company_id: existing?.group_company_id ?? companies[0]?.id ?? "",
    arrival_date: existing?.arrival_date ?? "",
    arrival_flight: existing?.arrival_flight ?? "",
    arrival_from: existing?.arrival_from ?? "",
    arrival_airport: existing?.arrival_airport ?? "",
    departure_date: existing?.departure_date ?? "",
    departure_flight: existing?.departure_flight ?? "",
    departure_to: existing?.departure_to ?? "",
    departure_airport: existing?.departure_airport ?? "",
    remarks: existing?.remarks ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [visaType, setVisaType] = useState<string>(existing?.visa_type ?? "normal");
  const [agentRows, setAgentRows] = useState<{ brn: string; city: string; hotel: string; check_in: string; check_out: string }[]>([]);
  const [masarGroupId, setMasarGroupId] = useState<string | null>(null);
  useUnsavedChanges(dirty);

  function addAgentRow() { setDirty(true); setAgentRows((r) => [...r, { brn: "", city: "Makkah", hotel: "", check_in: "", check_out: "" }]); }
  function setAgentRow(i: number, k: string, v: string) { setDirty(true); setAgentRows((r) => r.map((row, j) => j === i ? { ...row, [k]: v } : row)); }
  function removeAgentRow(i: number) { setDirty(true); setAgentRows((r) => r.filter((_, j) => j !== i)); }

  async function chooseMasar(opt: string) {
    if (!masarGroupId) return;
    await supabase.rpc("set_masar_option", { p_group: masarGroupId, p_option: opt });
    setDirty(false);
    router.push(`/groups/${masarGroupId}`);
    router.refresh();
  }

  useEffect(() => {
    if (isEdit) return;
    (async () => {
      const { data } = await supabase.rpc("next_group_no", { p_company: COMPANY_ID });
      if (data) setF((prev) => ({ ...prev, group_no: data as string }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nights =
    f.arrival_date && f.departure_date && f.departure_date > f.arrival_date
      ? Math.round((+new Date(f.departure_date) - +new Date(f.arrival_date)) / 86400000) : 0;

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setDirty(true);
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.group_no.trim()) return setError("Group number is required");
    if (Number(f.pax) <= 0) return setError("Pax must be greater than zero");
    if (!f.arrival_date || !f.departure_date) return setError("Arrival and departure dates are required");
    if (f.departure_date <= f.arrival_date) return setError("Departure must be after arrival");
    if (!f.arrival_flight.trim() || !f.departure_flight.trim()) return setError("Flight numbers are mandatory");
    if (!f.arrival_from || !f.arrival_airport || !f.departure_to || !f.departure_airport)
      return setError("Select all cities/airports from the dropdowns");

    setSaving(true);
    setError(null);
    const payload = {
      company_id: COMPANY_ID,
      group_no: f.group_no.trim(),
      group_date: f.group_date,
      group_name: f.group_name.trim() || null,
      pax: Number(f.pax),
      agent_id: f.agent_id || null,
      group_company_id: f.group_company_id || null,
      arrival_date: f.arrival_date,
      arrival_flight: f.arrival_flight.trim(),
      arrival_from: f.arrival_from,
      arrival_airport: f.arrival_airport,
      departure_date: f.departure_date,
      departure_flight: f.departure_flight.trim(),
      departure_to: f.departure_to,
      departure_airport: f.departure_airport,
      remarks: f.remarks.trim() || null,
      visa_type: visaType,
    };

    const dup = (e: any) =>
      e?.code === "23505" || /duplicate key|unique/i.test(e?.message ?? "")
        ? "This Group Number already exists. Please use a unique Group Number."
        : e.message;

    let gid: string;
    if (isEdit) {
      const { error } = await supabase.from("umrah_groups").update(payload).eq("id", existing!.id!);
      if (error) { setSaving(false); return setError(dup(error)); }
      gid = existing!.id!;
    } else {
      const { data, error } = await supabase.from("umrah_groups").insert(payload).select("id").single();
      if (error) { setSaving(false); return setError(dup(error)); }
      gid = data!.id;
    }

    // Masar: record agent-provided BRNs, then validate coverage
    if (visaType === "masar") {
      for (const r of agentRows) {
        if (!r.brn.trim() || !r.check_in || !r.check_out) continue;
        const { error: ae } = await supabase.rpc("add_agent_brn", {
          p_group: gid, p_brn: r.brn.trim(), p_city: r.city, p_hotel: r.hotel.trim() || r.brn.trim(),
          p_check_in: r.check_in, p_check_out: r.check_out,
        });
        if (ae) { setSaving(false); return setError(ae.message); }
      }
      const { data: complete } = await supabase.rpc("nusuk_complete", { p_group: gid });
      setSaving(false);
      if (agentRows.some((r) => r.brn.trim()) && !complete) { setMasarGroupId(gid); return; } // show options modal
      setDirty(false);
      router.push(`/groups/${gid}`); router.refresh();
      return;
    }

    setSaving(false);
    setDirty(false);
    router.push(`/groups/${gid}`);
    router.refresh();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">{isEdit ? "Edit Visa Group" : "New Visa Group"}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {isEdit ? "Update group details." : "Register a group. After saving you can auto-allocate hotel BRNs for the stay."}
      </p>
      <form onSubmit={save} className="space-y-5">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Visa Type</h2>
          <div className="flex gap-2">
            {[["normal", "Normal Visa"], ["masar", "Masar Visa"]].map(([v, lbl]) => (
              <button type="button" key={v} onClick={() => { setDirty(true); setVisaType(v); }}
                className={`rounded-md px-4 py-2 text-sm font-medium ${visaType === v ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {lbl}
              </button>
            ))}
          </div>
          {visaType === "masar" && <p className="text-xs text-slate-500">Masar: the agent has arranged the hotel BRNs — record them below. On save the ERP checks whether they satisfy the hotel coverage policy.</p>}
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Group Information</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div>
              <label className="label">Group number</label>
              <input className="input font-mono" value={f.group_no} onChange={(e) => set("group_no", e.target.value)} />
            </div>
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" value={f.group_date} onChange={(e) => set("group_date", e.target.value)} />
            </div>
            <div>
              <label className="label">Pax (pilgrims)</label>
              <input className="input" type="number" min={1} value={f.pax || ""} onChange={(e) => set("pax", Number(e.target.value))} required />
            </div>
            <div className="md:col-span-3">
              <label className="label">Group name</label>
              <input className="input" value={f.group_name} onChange={(e) => set("group_name", e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="label">Agent</label>
              <select className="input" value={f.agent_id} onChange={(e) => set("agent_id", e.target.value)}>
                <option value="">—</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Company</label>
              <select className="input" value={f.group_company_id} onChange={(e) => set("group_company_id", e.target.value)}>
                <option value="">—</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Arrival Flight</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <label className="label">Arrival date</label>
              <input className="input" type="date" value={f.arrival_date} onChange={(e) => set("arrival_date", e.target.value)} required />
            </div>
            <div>
              <label className="label">Flight number</label>
              <input className="input" value={f.arrival_flight} onChange={(e) => set("arrival_flight", e.target.value)} placeholder="SV-701" />
            </div>
            <div>
              <label className="label">From (city)</label>
              <AirportSelect airports={airports} value={f.arrival_from} onChange={(c) => set("arrival_from", c)} placeholder="Origin city" />
            </div>
            <div>
              <label className="label">Arrival airport (Saudi)</label>
              <AirportSelect airports={airports} value={f.arrival_airport} onChange={(c) => set("arrival_airport", c)} placeholder="Saudi airport" saudiOnly />
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Departure Flight</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <label className="label">Departure date</label>
              <input className="input" type="date" value={f.departure_date} min={f.arrival_date || undefined} onChange={(e) => set("departure_date", e.target.value)} required />
            </div>
            <div>
              <label className="label">Flight number</label>
              <input className="input" value={f.departure_flight} onChange={(e) => set("departure_flight", e.target.value)} placeholder="SV-702" />
            </div>
            <div>
              <label className="label">Departure airport (Saudi)</label>
              <AirportSelect airports={airports} value={f.departure_airport} onChange={(c) => set("departure_airport", c)} placeholder="Saudi airport" saudiOnly />
            </div>
            <div>
              <label className="label">To (international city)</label>
              <AirportSelect airports={airports} value={f.departure_to} onChange={(c) => set("departure_to", c)} placeholder="Destination city" />
            </div>
          </div>
          <div className="rounded-lg bg-brand/5 px-4 py-2 text-sm">
            Total stay: <b>{nights}</b> night(s)
            {nights > 0 && <span className="text-slate-500"> · {f.pax || 0} pax = {nights * (Number(f.pax) || 0)} bed-nights required</span>}
          </div>
        </div>

        <div className="card">
          <label className="label">Remarks</label>
          <input className="input" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />
        </div>

        {visaType === "masar" && (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-700">Agent Provided BRNs</h2>
              <button type="button" className="btn-outline text-sm" onClick={addAgentRow}>+ Add BRN</button>
            </div>
            {agentRows.length === 0 && <p className="text-sm text-slate-400">Add the BRNs the travel agent has already arranged.</p>}
            {agentRows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-2 md:grid-cols-6">
                <input className="input" placeholder="BRN" value={r.brn} onChange={(e) => setAgentRow(i, "brn", e.target.value)} />
                <select className="input" value={r.city} onChange={(e) => setAgentRow(i, "city", e.target.value)}>
                  <option>Makkah</option><option>Madinah</option><option>Jeddah</option>
                </select>
                <input className="input" placeholder="Hotel" value={r.hotel} onChange={(e) => setAgentRow(i, "hotel", e.target.value)} />
                <input className="input" type="date" value={r.check_in} onChange={(e) => setAgentRow(i, "check_in", e.target.value)} />
                <input className="input" type="date" min={r.check_in || undefined} value={r.check_out} onChange={(e) => setAgentRow(i, "check_out", e.target.value)} />
                <button type="button" className="text-sm text-red-600 hover:underline" onClick={() => removeAgentRow(i)}>Remove</button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save changes" : "Save group"}</button>
          <button type="button" className="btn-outline" onClick={() => { if (confirmDiscardIfDirty(dirty)) router.back(); }}>Cancel</button>
        </div>
      </form>

      {masarGroupId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800">Hotel allocation is incomplete</h3>
            <p className="mt-2 text-sm text-slate-600">The agent-provided BRNs don’t fully cover the stay under Nusuk rules. How would you like to proceed?</p>
            <div className="mt-4 space-y-2">
              <button className="btn w-full" onClick={() => chooseMasar("vista")}>
                Remaining BRN by Vista — allocate the rest from our inventory
              </button>
              <button className="btn-outline w-full" onClick={() => chooseMasar("later")}>
                Save for Later — the agent will provide the remaining BRNs
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">Agent BRNs are saved and locked either way. You can open the group later to continue.</p>
          </div>
        </div>
      )}
    </div>
  );
}
