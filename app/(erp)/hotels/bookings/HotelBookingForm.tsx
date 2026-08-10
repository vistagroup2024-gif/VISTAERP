"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { nightsBetween } from "../lib";

interface Opt { id: string; name: string }
interface HotelOpt { id: string; name: string; city: string | null }

export default function HotelBookingForm({
  existing, hotels, agents,
}: { existing: any | null; hotels: HotelOpt[]; agents: Opt[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    agent_id: existing?.agent_id ?? "",
    agent_ref: existing?.agent_ref ?? "",
    managed_by: existing?.managed_by ?? "",
    source: existing?.source ?? "",
    group_no: existing?.group_no ?? "",
    guest_name: existing?.guest_name ?? "",
    mobile: existing?.mobile ?? "",
    whatsapp: existing?.whatsapp ?? "",
    nationality: existing?.nationality ?? "",
    rooms: existing?.rooms ?? 1,
    guests: existing?.guests ?? 1,
    adults: existing?.adults ?? "",
    children: existing?.children ?? "",
    special_requests: existing?.special_requests ?? "",
    city: existing?.city ?? "makkah",
    hotel_id: existing?.hotel_id ?? "",
    hotel_name: existing?.hotel_name ?? "",
    check_in: existing?.check_in ?? "",
    check_out: existing?.check_out ?? "",
    room_type: existing?.room_type ?? "",
    meal_plan: existing?.meal_plan ?? "",
    hotel_requirements: existing?.hotel_requirements ?? "",
    sale_rate: existing?.sale_rate ?? "",
    taxes: existing?.taxes ?? "",
    sale_total: existing?.sale_total ?? "",
  });
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));

  const nights = useMemo(() => nightsBetween(f.check_in, f.check_out), [f.check_in, f.check_out]);
  // Auto-fill sale total from rate x nights x rooms if user hasn't overridden it.
  const suggestedTotal = useMemo(
    () => (Number(f.sale_rate) || 0) * (nights || 0) * (Number(f.rooms) || 0) + (Number(f.taxes) || 0),
    [f.sale_rate, nights, f.rooms, f.taxes]
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const payload = {
      ...f,
      hotel_name: f.hotel_id ? (hotels.find((h) => h.id === f.hotel_id)?.name ?? f.hotel_name) : f.hotel_name,
      sale_total: f.sale_total === "" ? String(suggestedTotal) : f.sale_total,
    };
    const { data, error } = await supabase.rpc("hotel_booking_save", {
      p_id: existing?.id ?? null, p: payload,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    router.push(`/hotels/bookings/${data}`);
    router.refresh();
  }

  const cities = ["makkah", "madinah", "jeddah", "other"];
  return (
    <form onSubmit={save} className="space-y-6">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Booking Information</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label">Agent / Customer</label>
            <select className="input" value={f.agent_id} onChange={(e) => set("agent_id", e.target.value)}>
              <option value="">— Direct / none —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div><label className="label">Agent Reference No.</label><input className="input" value={f.agent_ref} onChange={(e) => set("agent_ref", e.target.value)} /></div>
          <div><label className="label">Managed By / Salesperson</label><input className="input" value={f.managed_by} onChange={(e) => set("managed_by", e.target.value)} /></div>
          <div><label className="label">Booking Source</label><input className="input" placeholder="Portal / Phone / Walk-in" value={f.source} onChange={(e) => set("source", e.target.value)} /></div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Guest / Group Details</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div><label className="label">Group Number</label><input className="input" value={f.group_no} onChange={(e) => set("group_no", e.target.value)} /></div>
          <div><label className="label">Passenger / Group Name *</label><input required className="input" value={f.guest_name} onChange={(e) => set("guest_name", e.target.value)} /></div>
          <div><label className="label">Nationality</label><input className="input" value={f.nationality} onChange={(e) => set("nationality", e.target.value)} /></div>
          <div><label className="label">Mobile</label><input className="input" value={f.mobile} onChange={(e) => set("mobile", e.target.value)} /></div>
          <div><label className="label">WhatsApp</label><input className="input" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Rooms</label><input type="number" min={1} className="input" value={f.rooms} onChange={(e) => set("rooms", e.target.value)} /></div>
            <div><label className="label">Guests</label><input type="number" min={1} className="input" value={f.guests} onChange={(e) => set("guests", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Adults</label><input type="number" min={0} className="input" value={f.adults} onChange={(e) => set("adults", e.target.value)} /></div>
            <div><label className="label">Children</label><input type="number" min={0} className="input" value={f.children} onChange={(e) => set("children", e.target.value)} /></div>
          </div>
          <div className="md:col-span-3"><label className="label">Special Requests</label><textarea className="input" rows={2} value={f.special_requests} onChange={(e) => set("special_requests", e.target.value)} /></div>
        </div>
        <p className="text-xs text-slate-400">Attachments can be added from the booking page after saving.</p>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Hotel Stay Details</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label">City</label>
            <select className="input" value={f.city} onChange={(e) => set("city", e.target.value)}>
              {cities.map((c) => <option key={c} value={c} className="capitalize">{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Hotel (from master)</label>
            <select className="input" value={f.hotel_id} onChange={(e) => set("hotel_id", e.target.value)}>
              <option value="">— Not listed / free text —</option>
              {hotels.filter((h) => !f.city || !h.city || h.city === f.city).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div><label className="label">Hotel Name (if not in master)</label><input className="input" value={f.hotel_name} onChange={(e) => set("hotel_name", e.target.value)} disabled={!!f.hotel_id} /></div>
          <div><label className="label">Check-in *</label><input required type="date" className="input" value={f.check_in} onChange={(e) => set("check_in", e.target.value)} /></div>
          <div><label className="label">Check-out *</label><input required type="date" className="input" value={f.check_out} onChange={(e) => set("check_out", e.target.value)} /></div>
          <div><label className="label">Nights (auto)</label><input className="input bg-slate-50" value={nights} readOnly /></div>
          <div><label className="label">Room Type</label><input className="input" placeholder="Double / Triple / Quad" value={f.room_type} onChange={(e) => set("room_type", e.target.value)} /></div>
          <div><label className="label">Meal Plan</label><input className="input" placeholder="Room only / BB / HB / FB" value={f.meal_plan} onChange={(e) => set("meal_plan", e.target.value)} /></div>
          <div className="md:col-span-3"><label className="label">Special Hotel Requirements</label><textarea className="input" rows={2} value={f.hotel_requirements} onChange={(e) => set("hotel_requirements", e.target.value)} /></div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Sales Pricing</h2>
        <div className="grid gap-4 md:grid-cols-4">
          <div><label className="label">Sales Rate (per room/night)</label><input type="number" step="0.01" className="input" value={f.sale_rate} onChange={(e) => set("sale_rate", e.target.value)} /></div>
          <div><label className="label">Taxes / Fees</label><input type="number" step="0.01" className="input" value={f.taxes} onChange={(e) => set("taxes", e.target.value)} /></div>
          <div><label className="label">Sales Total {f.sale_total === "" && <span className="text-slate-400">(auto {suggestedTotal.toFixed(2)})</span>}</label><input type="number" step="0.01" className="input" placeholder={suggestedTotal.toFixed(2)} value={f.sale_total} onChange={(e) => set("sale_total", e.target.value)} /></div>
          <div className="flex items-end text-sm text-slate-500">{nights}n × {f.rooms || 0} rooms</div>
        </div>
      </section>

      <div className="flex gap-2">
        <button className="btn" disabled={saving}>{saving ? "Saving…" : existing ? "Save changes" : "Create booking"}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
