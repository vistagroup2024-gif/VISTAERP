"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { nightsBetween } from "../lib";

interface Opt { id: string; name: string }
interface HotelOpt { id: string; name: string; city: string | null }

// Preset suggestions for the select-or-type (datalist) fields. Users can pick one
// or type their own value.
const SOURCES = ["Portal", "Phone", "Walk-in", "WhatsApp", "Email", "Agent"];
const ROOM_TYPES = ["Single", "Double", "Triple", "Quad", "Quint", "Sharing"];
const MEAL_PLANS = ["Room Only", "Bed & Breakfast", "Half Board", "Full Board"];
const NATIONALITIES = ["Pakistan", "India", "Bangladesh", "Indonesia", "Malaysia", "Nigeria", "Egypt", "Turkey", "United Kingdom", "United States", "Saudi Arabia"];

// A "select or type" input: free text with a dropdown of suggestions.
function Combo({ label, value, onChange, options, listId, placeholder, className }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; listId: string; placeholder?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      <input className="input" list={listId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </div>
  );
}

export default function HotelBookingForm({
  existing, hotels, agents, salespeople = [],
}: { existing: any | null; hotels: HotelOpt[]; agents: Opt[]; salespeople?: string[] }) {
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
          <Combo label="Managed By / Salesperson" value={f.managed_by} onChange={(v) => set("managed_by", v)} options={salespeople} listId="dl-salespeople" placeholder="Select or type" />
          <Combo label="Booking Source" value={f.source} onChange={(v) => set("source", v)} options={SOURCES} listId="dl-source" placeholder="Select or type" />
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Guest Details</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div><label className="label">Passenger / Group Name *</label><input required className="input" value={f.guest_name} onChange={(e) => set("guest_name", e.target.value)} /></div>
          <Combo label="Nationality" value={f.nationality} onChange={(v) => set("nationality", v)} options={NATIONALITIES} listId="dl-nationality" placeholder="Select or type" />
          <div><label className="label">Guests</label><input type="number" min={1} className="input" value={f.guests} onChange={(e) => set("guests", e.target.value)} /></div>
          <div><label className="label">Mobile</label><input className="input" value={f.mobile} onChange={(e) => set("mobile", e.target.value)} /></div>
          <div><label className="label">WhatsApp</label><input className="input" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
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
            <label className="label">Hotel</label>
            <select className="input" value={f.hotel_id} onChange={(e) => set("hotel_id", e.target.value)}>
              <option value="">— Select hotel —</option>
              {hotels.filter((h) => !f.city || !h.city || h.city === f.city).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div><label className="label">Rooms</label><input type="number" min={1} className="input" value={f.rooms} onChange={(e) => set("rooms", e.target.value)} /></div>
          <div><label className="label">Check-in *</label><input required type="date" className="input" value={f.check_in} onChange={(e) => set("check_in", e.target.value)} /></div>
          <div><label className="label">Check-out *</label><input required type="date" className="input" value={f.check_out} onChange={(e) => set("check_out", e.target.value)} /></div>
          <div><label className="label">Nights (auto)</label><input className="input bg-slate-50" value={nights} readOnly /></div>
          <Combo label="Room Type" value={f.room_type} onChange={(v) => set("room_type", v)} options={ROOM_TYPES} listId="dl-roomtype" placeholder="Select or type" />
          <Combo label="Meal Plan" value={f.meal_plan} onChange={(v) => set("meal_plan", v)} options={MEAL_PLANS} listId="dl-mealplan" placeholder="Select or type" />
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
