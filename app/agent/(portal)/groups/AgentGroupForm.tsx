"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Airport = { code: string; city: string; is_saudi: boolean };
type Mode = "create" | "edit" | "view" | "hotel";

export default function AgentGroupForm({
  mode, airports, existing, groupId,
}: {
  mode: Mode;
  airports: Airport[];
  existing?: any;
  groupId?: string;
}) {
  const router = useRouter();
  const readOnly = mode === "view";        // under process — nothing editable
  const hotelOnly = mode === "hotel";      // visa issued — only hotel details
  const fieldsLocked = readOnly || hotelOnly;

  const [f, setF] = useState({
    group_name: existing?.group_name ?? "",
    pax: existing?.pax ?? 0,
    arrival_date: existing?.arrival_date ?? "",
    departure_date: existing?.departure_date ?? "",
    arrival_flight: existing?.arrival_flight ?? "",
    arrival_from: existing?.arrival_from ?? "",
    arrival_airport: existing?.arrival_airport ?? "",
    departure_flight: existing?.departure_flight ?? "",
    departure_to: existing?.departure_to ?? "",
    departure_airport: existing?.departure_airport ?? "",
    remarks: existing?.remarks ?? "",
  });
  const [hotels, setHotels] = useState<{ city: string; hotel: string; check_in: string; check_out: string }[]>(
    Array.isArray(existing?.hotel_details) ? existing.hotel_details : []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const addHotel = () => setHotels((r) => [...r, { city: "Makkah", hotel: "", check_in: "", check_out: "" }]);
  const setHotel = (i: number, k: string, v: string) => setHotels((r) => r.map((row, j) => j === i ? { ...row, [k]: v } : row));
  const removeHotel = (i: number) => setHotels((r) => r.filter((_, j) => j !== i));

  const AirportSel = ({ value, onChange, saudiOnly, disabled }: any) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">—</option>
      {airports.filter((a) => !saudiOnly || a.is_saudi).map((a) => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}
    </select>
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    let res: Response;
    const cleanHotels = hotels.filter((h) => h.hotel.trim() || h.check_in || h.check_out);
    if (hotelOnly) {
      res = await fetch("/api/agent/group", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "hotel", id: groupId, hotels: cleanHotels }) });
    } else {
      const payload = { ...f, hotel_details: cleanHotels };
      res = await fetch("/api/agent/group", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "create" ? { action: "create", payload } : { action: "update", id: groupId, payload }) });
    }
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(json.error ?? "Save failed");
    router.push(`/agent/groups/${json.id}`); router.refresh();
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">
          {mode === "create" ? "New Visa Group" : existing?.group_no ?? "Visa Group"}
        </h1>
      </div>

      {readOnly && <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">This group is being processed by Vista Group and can no longer be edited.</div>}
      {hotelOnly && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Visa issued — you may update <b>Hotel Details</b> only. All other fields are read-only.</div>}
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="card grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="col-span-2 md:col-span-1"><label className="label">Group name</label>
          <input className="input" value={f.group_name} onChange={(e) => set("group_name", e.target.value)} disabled={fieldsLocked} /></div>
        <div><label className="label">Pax</label>
          <input className="input" type="number" min={1} value={f.pax || ""} onChange={(e) => set("pax", Number(e.target.value))} disabled={fieldsLocked} /></div>
        <div><label className="label">Arrival date</label>
          <input className="input" type="date" value={f.arrival_date} onChange={(e) => set("arrival_date", e.target.value)} disabled={fieldsLocked} /></div>
        <div><label className="label">Departure date</label>
          <input className="input" type="date" min={f.arrival_date || undefined} value={f.departure_date} onChange={(e) => set("departure_date", e.target.value)} disabled={fieldsLocked} /></div>
      </div>

      <div className="card grid grid-cols-2 gap-4 md:grid-cols-4">
        <p className="col-span-2 md:col-span-4 font-semibold text-slate-700">✈️ Flight Details</p>
        <div><label className="label">Arrival flight</label>
          <input className="input" value={f.arrival_flight} onChange={(e) => set("arrival_flight", e.target.value)} disabled={fieldsLocked} /></div>
        <div><label className="label">From</label><AirportSel value={f.arrival_from} onChange={(v: string) => set("arrival_from", v)} disabled={fieldsLocked} /></div>
        <div><label className="label">To (Saudi)</label><AirportSel value={f.arrival_airport} onChange={(v: string) => set("arrival_airport", v)} saudiOnly disabled={fieldsLocked} /></div>
        <div></div>
        <div><label className="label">Departure flight</label>
          <input className="input" value={f.departure_flight} onChange={(e) => set("departure_flight", e.target.value)} disabled={fieldsLocked} /></div>
        <div><label className="label">From (Saudi)</label><AirportSel value={f.departure_airport} onChange={(v: string) => set("departure_airport", v)} saudiOnly disabled={fieldsLocked} /></div>
        <div><label className="label">To</label><AirportSel value={f.departure_to} onChange={(v: string) => set("departure_to", v)} disabled={fieldsLocked} /></div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">🏨 Hotel Details</h2>
          {!readOnly && <button type="button" className="btn-outline text-sm" onClick={addHotel}>+ Add Hotel</button>}
        </div>
        {hotels.length === 0 && <p className="text-sm text-slate-400">No hotel rows.</p>}
        {hotels.map((h, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-2 md:grid-cols-5">
            <select className="input" value={h.city} onChange={(e) => setHotel(i, "city", e.target.value)} disabled={readOnly}>
              <option>Makkah</option><option>Madinah</option><option>Jeddah</option><option>Other</option>
            </select>
            <input className="input md:col-span-2" placeholder="Hotel name" value={h.hotel} onChange={(e) => setHotel(i, "hotel", e.target.value)} disabled={readOnly} />
            <input className="input" type="date" value={h.check_in} onChange={(e) => setHotel(i, "check_in", e.target.value)} disabled={readOnly} />
            <div className="flex gap-2">
              <input className="input" type="date" min={h.check_in || undefined} value={h.check_out} onChange={(e) => setHotel(i, "check_out", e.target.value)} disabled={readOnly} />
              {!readOnly && <button type="button" className="text-sm text-red-600 hover:underline" onClick={() => removeHotel(i)}>✕</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <label className="label">Remarks</label>
        <input className="input" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} disabled={fieldsLocked} />
      </div>

      <div className="flex gap-2">
        {!readOnly && <button className="btn" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Create group" : hotelOnly ? "Save Hotel Details" : "Save changes"}</button>}
        <button type="button" className="btn-outline" onClick={() => router.push("/agent/groups")}>Back</button>
      </div>
    </form>
  );
}
