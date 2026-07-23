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
  hotel_details?: { city: string; hotel: string; check_in: string; check_out: string }[];
}

export default function GroupForm({
  airports, agents, companies, existing,
  variant = "staff", agencyName, lockAll = false, hotelOnly = false, canAgentBrn = false, groupId,
}: {
  airports: Airport[];
  agents: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  existing?: GroupInitial;
  variant?: "staff" | "agent";
  agencyName?: string;
  lockAll?: boolean;
  hotelOnly?: boolean;
  canAgentBrn?: boolean;
  groupId?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isAgent = variant === "agent";
  const isEdit = isAgent ? !!groupId : !!existing?.id;
  const basePath = isAgent ? "/agent/groups" : "/groups";
  const gidFor = isAgent ? groupId : existing?.id;
  const disNonHotel = lockAll || hotelOnly;   // fields other than hotel details
  const disHotel = lockAll;                    // hotel rows
  const showVisaType = !isAgent || canAgentBrn;
  const canSave = !lockAll;

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
  const [hotelRows, setHotelRows] = useState<{ city: string; hotel: string; check_in: string; check_out: string }[]>(
    Array.isArray(existing?.hotel_details) ? existing!.hotel_details : []);
  useUnsavedChanges(dirty);

  function addHotelRow() { setDirty(true); setHotelRows((r) => [...r, { city: "Makkah", hotel: "", check_in: "", check_out: "" }]); }
  function setHotelRow(i: number, k: string, v: string) { setDirty(true); setHotelRows((r) => r.map((row, j) => j === i ? { ...row, [k]: v } : row)); }
  function removeHotelRow(i: number) { setDirty(true); setHotelRows((r) => r.filter((_, j) => j !== i)); }
  function addAgentRow() { setDirty(true); setAgentRows((r) => [...r, { brn: "", city: "Makkah", hotel: "", check_in: "", check_out: "" }]); }
  function setAgentRow(i: number, k: string, v: string) { setDirty(true); setAgentRows((r) => r.map((row, j) => j === i ? { ...row, [k]: v } : row)); }
  function removeAgentRow(i: number) { setDirty(true); setAgentRows((r) => r.filter((_, j) => j !== i)); }

  async function agentPost(bodyObj: any) {
    const res = await fetch("/api/agent/group", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Save failed");
    return json;
  }

  async function chooseMasar(opt: string) {
    if (!masarGroupId) return;
    if (isAgent) await agentPost({ action: "masar_option", id: masarGroupId, option: opt });
    else await supabase.rpc("set_masar_option", { p_group: masarGroupId, p_option: opt });
    setDirty(false);
    router.push(`${basePath}/${masarGroupId}`); router.refresh();
  }

  useEffect(() => {
    if (isEdit || isAgent) return;
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

    // Hotel-only edit (agent, visa issued) — save just the hotel rows.
    if (hotelOnly) {
      setSaving(true); setError(null);
      try {
        await agentPost({ action: "hotel", id: gidFor, hotels: hotelRows.filter((h) => h.hotel.trim() || h.check_in || h.check_out) });
        setDirty(false); router.push(`${basePath}/${gidFor}`); router.refresh();
      } catch (err: any) { setError(err.message); } finally { setSaving(false); }
      return;
    }

    if (!isAgent && !f.group_no.trim()) return setError("Group number is required");
    if (Number(f.pax) <= 0) return setError("Pax must be greater than zero");
    if (!f.arrival_date || !f.departure_date) return setError("Arrival and departure dates are required");
    if (f.departure_date <= f.arrival_date) return setError("Departure must be after arrival");
    if (!f.arrival_flight.trim() || !f.departure_flight.trim()) return setError("Flight numbers are mandatory");
    if (!f.arrival_from || !f.arrival_airport || !f.departure_to || !f.departure_airport)
      return setError("Select all cities/airports from the dropdowns");

    setSaving(true); setError(null);
    const payload: any = {
      group_name: f.group_name.trim() || null,
      pax: Number(f.pax),
      arrival_date: f.arrival_date,
      arrival_flight: f.arrival_flight.trim(),
      arrival_from: f.arrival_from,
      arrival_airport: f.arrival_airport,
      departure_date: f.departure_date,
      departure_flight: f.departure_flight.trim(),
      departure_to: f.departure_to,
      departure_airport: f.departure_airport,
      remarks: f.remarks.trim() || null,
      hotel_details: hotelRows.filter((h) => h.hotel.trim() || h.check_in || h.check_out),
    };

    // ---------- Agent variant ----------
    if (isAgent) {
      try {
        const r = isEdit
          ? await agentPost({ action: "update", id: gidFor, payload })
          : await agentPost({ action: "create", payload });
        const gid = r.id;
        if (showVisaType && visaType === "masar" && agentRows.some((x) => x.brn.trim())) {
          for (const row of agentRows) {
            if (!row.brn.trim() || !row.check_in || !row.check_out) continue;
            await agentPost({ action: "add_agent_brn", id: gid, row });
          }
          const c = await agentPost({ action: "nusuk_complete", id: gid });
          if (!c.complete) { setSaving(false); setMasarGroupId(gid); return; }
        }
        setSaving(false); setDirty(false);
        router.push(`${basePath}/${gid}`); router.refresh();
      } catch (err: any) { setSaving(false); setError(err.message); }
      return;
    }

    // ---------- Staff variant (unchanged behaviour) ----------
    const staffPayload = {
      ...payload,
      company_id: COMPANY_ID, group_no: f.group_no.trim(), group_date: f.group_date,
      agent_id: f.agent_id || null, group_company_id: f.group_company_id || null, visa_type: visaType,
    };
    const dup = (e: any) =>
      e?.code === "23505" || /duplicate key|unique/i.test(e?.message ?? "")
        ? "This Group Number already exists. Please use a unique Group Number." : e.message;
    let gid: string;
    if (isEdit) {
      const { error } = await supabase.from("umrah_groups").update(staffPayload).eq("id", existing!.id!);
      if (error) { setSaving(false); return setError(dup(error)); }
      gid = existing!.id!;
    } else {
      const { data, error } = await supabase.from("umrah_groups").insert(staffPayload).select("id").single();
      if (error) { setSaving(false); return setError(dup(error)); }
      gid = data!.id;
    }
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
      if (agentRows.some((r) => r.brn.trim()) && !complete) { setMasarGroupId(gid); return; }
      setDirty(false); router.push(`${basePath}/${gid}`); router.refresh();
      return;
    }
    setSaving(false); setDirty(false);
    router.push(`${basePath}/${gid}`); router.refresh();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">{isEdit ? (isAgent ? (existing?.group_no ?? "Visa Group") : "Edit Visa Group") : "New Visa Group"}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {isEdit ? "Update group details." : "Register a group. After saving you can auto-allocate hotel BRNs for the stay."}
      </p>
      <form onSubmit={save} className="space-y-5">
        {lockAll && <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">This group is being processed by Vista Group and can no longer be edited.</div>}
        {hotelOnly && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Visa issued — you may update <b>Hotel Details</b> only. All other fields are read-only.</div>}
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {showVisaType && (
          <div className="card space-y-3">
            <h2 className="font-semibold text-slate-700">Visa Type</h2>
            <div className="flex gap-2">
              {[["normal", "Normal Visa"], ["masar", "Masar Visa"]].map(([v, lbl]) => (
                <button type="button" key={v} disabled={disNonHotel} onClick={() => { setDirty(true); setVisaType(v); }}
                  className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${visaType === v ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {lbl}
                </button>
              ))}
            </div>
            {visaType === "masar" && <p className="text-xs text-slate-500">Masar: the agent has arranged the hotel BRNs — record them below. On save the ERP checks whether they satisfy the hotel coverage policy.</p>}
          </div>
        )}

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Group Information</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div>
              <label className="label">Group number</label>
              <input className="input font-mono" value={f.group_no} onChange={(e) => set("group_no", e.target.value)} disabled={isAgent} placeholder={isAgent && !f.group_no ? "(auto)" : undefined} />
            </div>
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" value={f.group_date} onChange={(e) => set("group_date", e.target.value)} disabled={isAgent || disNonHotel} />
            </div>
            <div>
              <label className="label">Pax (pilgrims)</label>
              <input className="input" type="number" min={1} value={f.pax || ""} onChange={(e) => set("pax", Number(e.target.value))} disabled={disNonHotel} required />
            </div>
            <div className="md:col-span-3">
              <label className="label">Group name</label>
              <input className="input" value={f.group_name} onChange={(e) => set("group_name", e.target.value)} placeholder="Optional" disabled={disNonHotel} />
            </div>
            <div>
              <label className="label">Agent</label>
              {isAgent
                ? <input className="input bg-slate-50" value={agencyName ?? ""} disabled readOnly title="Linked to your account" />
                : <select className="input" value={f.agent_id} onChange={(e) => set("agent_id", e.target.value)}>
                    <option value="">—</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>}
            </div>
            <div>
              <label className="label">Company</label>
              {isAgent
                ? <input className="input bg-slate-50" value="Assigned by Vista" disabled readOnly />
                : <select className="input" value={f.group_company_id} onChange={(e) => set("group_company_id", e.target.value)}>
                    <option value="">—</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>}
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Arrival Flight</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <label className="label">Arrival date</label>
              <input className="input" type="date" value={f.arrival_date} onChange={(e) => set("arrival_date", e.target.value)} disabled={disNonHotel} required />
            </div>
            <div>
              <label className="label">Flight number</label>
              <input className="input" value={f.arrival_flight} onChange={(e) => set("arrival_flight", e.target.value)} placeholder="SV-701" disabled={disNonHotel} />
            </div>
            <div>
              <label className="label">From (city)</label>
              <AirportSelect airports={airports} value={f.arrival_from} onChange={(c) => set("arrival_from", c)} placeholder="Origin city" disabled={disNonHotel} />
            </div>
            <div>
              <label className="label">Arrival airport (Saudi)</label>
              <AirportSelect airports={airports} value={f.arrival_airport} onChange={(c) => set("arrival_airport", c)} placeholder="Saudi airport" saudiOnly disabled={disNonHotel} />
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Departure Flight</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <label className="label">Departure date</label>
              <input className="input" type="date" value={f.departure_date} min={f.arrival_date || undefined} onChange={(e) => set("departure_date", e.target.value)} disabled={disNonHotel} required />
            </div>
            <div>
              <label className="label">Flight number</label>
              <input className="input" value={f.departure_flight} onChange={(e) => set("departure_flight", e.target.value)} placeholder="SV-702" disabled={disNonHotel} />
            </div>
            <div>
              <label className="label">Departure airport (Saudi)</label>
              <AirportSelect airports={airports} value={f.departure_airport} onChange={(c) => set("departure_airport", c)} placeholder="Saudi airport" saudiOnly disabled={disNonHotel} />
            </div>
            <div>
              <label className="label">To (international city)</label>
              <AirportSelect airports={airports} value={f.departure_to} onChange={(c) => set("departure_to", c)} placeholder="Destination city" disabled={disNonHotel} />
            </div>
          </div>
          <div className="rounded-lg bg-brand/5 px-4 py-2 text-sm">
            Total stay: <b>{nights}</b> night(s)
            {nights > 0 && <span className="text-slate-500"> · {f.pax || 0} pax = {nights * (Number(f.pax) || 0)} bed-nights required</span>}
          </div>
        </div>

        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-700">🏨 Hotel Details</h2>
              <p className="text-xs text-slate-500">Original hotel itinerary from the agent — reference only, independent of BRN allocation.</p>
            </div>
            {!disHotel && <button type="button" className="btn-outline text-sm" onClick={addHotelRow}>+ Add Hotel</button>}
          </div>
          {hotelRows.length === 0 && <p className="text-sm text-slate-400">No hotel rows yet.</p>}
          {hotelRows.map((h, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-2 md:grid-cols-5">
              <select className="input" value={h.city} onChange={(e) => setHotelRow(i, "city", e.target.value)} disabled={disHotel}>
                <option>Makkah</option><option>Madinah</option><option>Jeddah</option><option>Other</option>
              </select>
              <input className="input md:col-span-2" placeholder="Hotel name" value={h.hotel} onChange={(e) => setHotelRow(i, "hotel", e.target.value)} disabled={disHotel} />
              <input className="input" type="date" value={h.check_in} onChange={(e) => setHotelRow(i, "check_in", e.target.value)} disabled={disHotel} />
              <div className="flex gap-2">
                <input className="input" type="date" min={h.check_in || undefined} value={h.check_out} onChange={(e) => setHotelRow(i, "check_out", e.target.value)} disabled={disHotel} />
                {!disHotel && <button type="button" className="text-sm text-red-600 hover:underline" onClick={() => removeHotelRow(i)}>✕</button>}
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <label className="label">Remarks</label>
          <input className="input" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} disabled={disNonHotel} />
        </div>

        {showVisaType && visaType === "masar" && (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-700">Agent Provided BRNs</h2>
              {!disNonHotel && <button type="button" className="btn-outline text-sm" onClick={addAgentRow}>+ Add BRN</button>}
            </div>
            {agentRows.length === 0 && <p className="text-sm text-slate-400">Add the BRNs the travel agent has already arranged.</p>}
            {agentRows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-2 md:grid-cols-6">
                <input className="input" placeholder="BRN" value={r.brn} onChange={(e) => setAgentRow(i, "brn", e.target.value)} disabled={disNonHotel} />
                <select className="input" value={r.city} onChange={(e) => setAgentRow(i, "city", e.target.value)} disabled={disNonHotel}>
                  <option>Makkah</option><option>Madinah</option><option>Jeddah</option>
                </select>
                <input className="input" placeholder="Hotel" value={r.hotel} onChange={(e) => setAgentRow(i, "hotel", e.target.value)} disabled={disNonHotel} />
                <input className="input" type="date" value={r.check_in} onChange={(e) => setAgentRow(i, "check_in", e.target.value)} disabled={disNonHotel} />
                <input className="input" type="date" min={r.check_in || undefined} value={r.check_out} onChange={(e) => setAgentRow(i, "check_out", e.target.value)} disabled={disNonHotel} />
                {!disNonHotel && <button type="button" className="text-sm text-red-600 hover:underline" onClick={() => removeAgentRow(i)}>Remove</button>}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {canSave && <button className="btn" disabled={saving}>{saving ? "Saving…" : hotelOnly ? "Save Hotel Details" : isEdit ? "Save changes" : "Save group"}</button>}
          <button type="button" className="btn-outline" onClick={() => { if (confirmDiscardIfDirty(dirty)) router.push(isAgent ? "/agent/groups" : "/groups"); }}>{canSave ? "Cancel" : "Back"}</button>
        </div>
      </form>

      {masarGroupId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800">Hotel allocation is incomplete</h3>
            <p className="mt-2 text-sm text-slate-600">The agent-provided BRNs don’t fully cover the stay under Nusuk rules. How would you like to proceed?</p>
            <div className="mt-4 space-y-2">
              <button className="btn w-full" onClick={() => chooseMasar("vista")}>Remaining BRN by Vista — allocate the rest from our inventory</button>
              <button className="btn-outline w-full" onClick={() => chooseMasar("later")}>Save for Later — the agent will provide the remaining BRNs</button>
            </div>
            <p className="mt-3 text-xs text-slate-400">Agent BRNs are saved and locked either way. You can open the group later to continue.</p>
          </div>
        </div>
      )}
    </div>
  );
}
