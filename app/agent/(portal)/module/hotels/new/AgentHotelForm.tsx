"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { nightsBetween } from "@/app/(erp)/hotels/lib";

interface HotelOpt { id: string; name: string; city: string | null }

export default function AgentHotelForm({ hotels }: { hotels: HotelOpt[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    guest_name: "", group_no: "", mobile: "", whatsapp: "", nationality: "",
    rooms: 1, guests: 1, special_requests: "",
    city: "makkah", hotel_id: "", hotel_name: "", check_in: "", check_out: "",
    room_type: "", meal_plan: "", hotel_requirements: "",
  });
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const nights = useMemo(() => nightsBetween(f.check_in, f.check_out), [f.check_in, f.check_out]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const res = await fetch("/api/agent/hotel", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", payload: f }),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setErr(j.error || "Failed");
    router.push("/agent/module/hotels?created=1");
    router.refresh();
  }

  const cities = ["makkah", "madinah", "jeddah", "other"];
  return (
    <form onSubmit={submit} className="space-y-6">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Guest / Group</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div><label className="label">Passenger / Group Name *</label><input required className="input" value={f.guest_name} onChange={(e) => set("guest_name", e.target.value)} /></div>
          <div><label className="label">Group Number</label><input className="input" value={f.group_no} onChange={(e) => set("group_no", e.target.value)} /></div>
          <div><label className="label">Nationality</label><input className="input" value={f.nationality} onChange={(e) => set("nationality", e.target.value)} /></div>
          <div><label className="label">Mobile</label><input className="input" value={f.mobile} onChange={(e) => set("mobile", e.target.value)} /></div>
          <div><label className="label">WhatsApp</label><input className="input" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Rooms</label><input type="number" min={1} className="input" value={f.rooms} onChange={(e) => set("rooms", e.target.value)} /></div>
            <div><label className="label">Guests</label><input type="number" min={1} className="input" value={f.guests} onChange={(e) => set("guests", e.target.value)} /></div>
          </div>
        </div>
      </section>
      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Hotel Stay</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div><label className="label">City</label>
            <select className="input" value={f.city} onChange={(e) => set("city", e.target.value)}>
              {cities.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div><label className="label">Hotel</label>
            <select className="input" value={f.hotel_id} onChange={(e) => set("hotel_id", e.target.value)}>
              <option value="">— Not listed —</option>
              {hotels.filter((h) => !f.city || !h.city || h.city === f.city).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div><label className="label">Hotel (if not listed)</label><input className="input" value={f.hotel_name} disabled={!!f.hotel_id} onChange={(e) => set("hotel_name", e.target.value)} /></div>
          <div><label className="label">Check-in *</label><input required type="date" className="input" value={f.check_in} onChange={(e) => set("check_in", e.target.value)} /></div>
          <div><label className="label">Check-out *</label><input required type="date" className="input" value={f.check_out} onChange={(e) => set("check_out", e.target.value)} /></div>
          <div><label className="label">Nights</label><input className="input bg-slate-50" value={nights} readOnly /></div>
          <div><label className="label">Room Type</label><input className="input" value={f.room_type} onChange={(e) => set("room_type", e.target.value)} /></div>
          <div><label className="label">Meal Plan</label><input className="input" value={f.meal_plan} onChange={(e) => set("meal_plan", e.target.value)} /></div>
          <div className="md:col-span-3"><label className="label">Special Requests</label><textarea className="input" rows={2} value={f.special_requests} onChange={(e) => set("special_requests", e.target.value)} /></div>
        </div>
      </section>
      <div className="flex gap-2">
        <button className="btn" disabled={saving}>{saving ? "Submitting…" : "Submit request"}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
