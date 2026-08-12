"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { nightsBetween } from "../lib";

interface Opt { id: string; name: string }
interface HotelOpt { id: string; name: string; city: string | null }

// Preset suggestions for the select-or-type (datalist) fields.
const SOURCES = ["Portal", "Phone", "Walk-in", "WhatsApp", "Email", "Agent"];
const ROOM_TYPES = ["Single", "Double", "Triple", "Quad", "Quint", "Sharing"];
const MEAL_PLANS = ["Room Only", "Bed & Breakfast", "Half Board", "Full Board"];
const NATIONALITIES = ["Pakistan", "India", "Bangladesh", "Indonesia", "Malaysia", "Nigeria", "Egypt", "Turkey", "United Kingdom", "United States", "Saudi Arabia"];
const CITIES = ["makkah", "madinah", "jeddah", "other"];

// A "select or type" input: free text with a dropdown of suggestions.
function Combo({ label, value, onChange, options, listId, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; listId: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" list={listId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </div>
  );
}

interface StayForm {
  id?: string;
  city: string; hotel_id: string; hotel_name: string; room_type: string; meal_plan: string;
  check_in: string; check_out: string; rooms: number | string;
  sale_rate: number | string; sale_total: number | string;
  supplier_id: string; purchase_rate: number | string; purchase_total: number | string; currency: string;
  supplier_ref: string; notes: string;
}

function blankStay(): StayForm {
  return {
    city: "makkah", hotel_id: "", hotel_name: "", room_type: "", meal_plan: "",
    check_in: "", check_out: "", rooms: 1,
    sale_rate: "", sale_total: "", supplier_id: "", purchase_rate: "", purchase_total: "", currency: "SAR",
    supplier_ref: "", notes: "",
  };
}

function stayFromRow(s: any): StayForm {
  return {
    id: s.id,
    city: s.city ?? "makkah", hotel_id: s.hotel_id ?? "", hotel_name: s.hotel_name ?? "",
    room_type: s.room_type ?? "", meal_plan: s.meal_plan ?? "",
    check_in: s.check_in ?? "", check_out: s.check_out ?? "", rooms: s.rooms ?? 1,
    sale_rate: s.sale_rate ?? "", sale_total: s.sale_total ?? "",
    supplier_id: s.supplier_id ?? "", purchase_rate: s.purchase_rate ?? "", purchase_total: s.purchase_total ?? "",
    currency: s.currency ?? "SAR", supplier_ref: s.supplier_ref ?? "", notes: s.notes ?? "",
  };
}

export default function HotelBookingForm({
  existing, stays: existingStays = [], hotels, agents, suppliers = [], salespeople = [],
}: {
  existing: any | null; stays?: any[]; hotels: HotelOpt[]; agents: Opt[]; suppliers?: Opt[]; salespeople?: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [h, setH] = useState({
    agent_id: existing?.agent_id ?? "",
    managed_by: existing?.managed_by ?? "",
    source: existing?.source ?? "",
    guest_name: existing?.guest_name ?? "",
    mobile: existing?.mobile ?? "",
    whatsapp: existing?.whatsapp ?? "",
    nationality: existing?.nationality ?? "",
    guests: existing?.guests ?? 1,
    hotel_requirements: existing?.hotel_requirements ?? "",
  });
  const setHeader = (k: string, v: any) => setH((s) => ({ ...s, [k]: v }));

  const [stays, setStays] = useState<StayForm[]>(
    existingStays.length ? existingStays.map(stayFromRow) : [blankStay()]
  );
  const setStay = (i: number, k: keyof StayForm, v: any) =>
    setStays((arr) => arr.map((s, idx) => (idx === i ? { ...s, [k]: v } : s)));
  const addStay = () => setStays((arr) => [...arr, blankStay()]);
  const removeStay = (i: number) => setStays((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));

  // Suggested totals per stay = rate x nights x rooms; user can override.
  function nightsOf(s: StayForm) { return nightsBetween(s.check_in, s.check_out); }
  function suggestedSale(s: StayForm) { return (Number(s.sale_rate) || 0) * nightsOf(s) * (Number(s.rooms) || 0); }
  function suggestedPurchase(s: StayForm) { return (Number(s.purchase_rate) || 0) * nightsOf(s) * (Number(s.rooms) || 0); }
  function saleTotalOf(s: StayForm) { return s.sale_total === "" ? suggestedSale(s) : Number(s.sale_total) || 0; }
  function purchaseTotalOf(s: StayForm) { return s.purchase_total === "" ? suggestedPurchase(s) : Number(s.purchase_total) || 0; }

  const grandSale = useMemo(() => stays.reduce((a, s) => a + saleTotalOf(s), 0), [stays]);
  const grandPurchase = useMemo(() => stays.reduce((a, s) => a + purchaseTotalOf(s), 0), [stays]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const header = { ...h, guests: String(h.guests) };
    const payloadStays = stays.map((s, i) => ({
      id: s.id,
      city: s.city,
      hotel_id: s.hotel_id,
      hotel_name: s.hotel_id ? (hotels.find((x) => x.id === s.hotel_id)?.name ?? "") : s.hotel_name,
      room_type: s.room_type,
      meal_plan: s.meal_plan,
      check_in: s.check_in,
      check_out: s.check_out,
      rooms: String(s.rooms || 1),
      sale_rate: String(s.sale_rate || 0),
      sale_total: String(saleTotalOf(s)),
      supplier_id: s.supplier_id,
      purchase_rate: String(s.purchase_rate || 0),
      purchase_total: String(purchaseTotalOf(s)),
      currency: s.currency || "SAR",
      supplier_ref: s.supplier_ref,
      notes: s.notes,
      sort: String(i),
    }));
    const { data, error } = await supabase.rpc("hotel_booking_save_full", {
      p_id: existing?.id ?? null, p: header, p_stays: payloadStays,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    router.push(`/hotels/bookings/${data}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Booking Information</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label">Agent / Customer</label>
            <select className="input" value={h.agent_id} onChange={(e) => setHeader("agent_id", e.target.value)}>
              <option value="">— Direct / none —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <Combo label="Managed By / Salesperson" value={h.managed_by} onChange={(v) => setHeader("managed_by", v)} options={salespeople} listId="dl-salespeople" placeholder="Select or type" />
          <Combo label="Booking Source" value={h.source} onChange={(v) => setHeader("source", v)} options={SOURCES} listId="dl-source" placeholder="Select or type" />
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-700">Guest Details</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div><label className="label">Passenger / Group Name *</label><input required className="input" value={h.guest_name} onChange={(e) => setHeader("guest_name", e.target.value)} /></div>
          <Combo label="Nationality" value={h.nationality} onChange={(v) => setHeader("nationality", v)} options={NATIONALITIES} listId="dl-nationality" placeholder="Select or type" />
          <div><label className="label">Guests</label><input type="number" min={1} className="input" value={h.guests} onChange={(e) => setHeader("guests", e.target.value)} /></div>
          <div><label className="label">Mobile</label><input className="input" value={h.mobile} onChange={(e) => setHeader("mobile", e.target.value)} /></div>
          <div><label className="label">WhatsApp</label><input className="input" value={h.whatsapp} onChange={(e) => setHeader("whatsapp", e.target.value)} /></div>
        </div>
        <p className="text-xs text-slate-400">Attachments can be added from the booking page after saving.</p>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">Hotel Stays</h2>
          <button type="button" className="btn-outline text-sm" onClick={addStay}>+ Add hotel stay</button>
        </div>

        {stays.map((s, i) => {
          const nights = nightsOf(s);
          return (
            <div key={i} className="card space-y-4 border-l-4 border-brand/60">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-600">Stay {i + 1}</h3>
                {stays.length > 1 && (
                  <button type="button" className="text-sm text-red-500 hover:underline" onClick={() => removeStay(i)}>Remove</button>
                )}
              </div>

              {/* Stay + room details */}
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="label">City</label>
                  <select className="input" value={s.city} onChange={(e) => setStay(i, "city", e.target.value)}>
                    {CITIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Hotel</label>
                  <select className="input" value={s.hotel_id} onChange={(e) => setStay(i, "hotel_id", e.target.value)}>
                    <option value="">— Free text below —</option>
                    {hotels.filter((x) => !s.city || !x.city || x.city === s.city).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Hotel (free text)</label><input className="input" value={s.hotel_name} disabled={!!s.hotel_id} onChange={(e) => setStay(i, "hotel_name", e.target.value)} /></div>
                <div><label className="label">Check-in *</label><input required type="date" className="input" value={s.check_in} onChange={(e) => setStay(i, "check_in", e.target.value)} /></div>
                <div><label className="label">Check-out *</label><input required type="date" className="input" value={s.check_out} onChange={(e) => setStay(i, "check_out", e.target.value)} /></div>
                <div><label className="label">Nights (auto)</label><input className="input bg-slate-50" value={nights} readOnly /></div>
                <div><label className="label">Rooms</label><input type="number" min={1} className="input" value={s.rooms} onChange={(e) => setStay(i, "rooms", e.target.value)} /></div>
                <Combo label="Room Type" value={s.room_type} onChange={(v) => setStay(i, "room_type", v)} options={ROOM_TYPES} listId={`dl-roomtype-${i}`} placeholder="Select or type" />
                <Combo label="Meal Plan" value={s.meal_plan} onChange={(v) => setStay(i, "meal_plan", v)} options={MEAL_PLANS} listId={`dl-mealplan-${i}`} placeholder="Select or type" />
              </div>

              {/* Sale pricing */}
              <div className="rounded-md bg-emerald-50/60 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Sale</div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><label className="label">Sale Price / night</label><input type="number" step="0.01" className="input" value={s.sale_rate} onChange={(e) => setStay(i, "sale_rate", e.target.value)} /></div>
                  <div>
                    <label className="label">Sale Total {s.sale_total === "" && <span className="text-slate-400">(auto {suggestedSale(s).toFixed(2)})</span>}</label>
                    <input type="number" step="0.01" className="input" placeholder={suggestedSale(s).toFixed(2)} value={s.sale_total} onChange={(e) => setStay(i, "sale_total", e.target.value)} />
                  </div>
                  <div className="flex items-end text-sm text-slate-500">{nights}n × {s.rooms || 0} rooms</div>
                </div>
              </div>

              {/* Purchase / vendor */}
              <div className="rounded-md bg-slate-50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Purchase / Vendor</div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="label">Vendor / Supplier</label>
                    <select className="input" value={s.supplier_id} onChange={(e) => setStay(i, "supplier_id", e.target.value)}>
                      <option value="">— Select —</option>
                      {suppliers.map((sup) => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                    </select>
                  </div>
                  <div><label className="label">Purchase Price / night</label><input type="number" step="0.01" className="input" value={s.purchase_rate} onChange={(e) => setStay(i, "purchase_rate", e.target.value)} /></div>
                  <div>
                    <label className="label">Purchase Total {s.purchase_total === "" && <span className="text-slate-400">(auto {suggestedPurchase(s).toFixed(2)})</span>}</label>
                    <input type="number" step="0.01" className="input" placeholder={suggestedPurchase(s).toFixed(2)} value={s.purchase_total} onChange={(e) => setStay(i, "purchase_total", e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-3"><label className="label">Special Hotel Requirements</label><textarea className="input" rows={2} value={h.hotel_requirements} onChange={(e) => setHeader("hotel_requirements", e.target.value)} /></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-6 border-t border-slate-100 pt-3 text-sm">
          <div>Grand Purchase: <b>{money(grandPurchase, "SAR")}</b></div>
          <div className="text-base">Grand Sale Total: <b className="text-emerald-700">{money(grandSale, "SAR")}</b></div>
        </div>
      </section>

      <div className="flex gap-2">
        <button className="btn" disabled={saving}>{saving ? "Saving…" : existing ? "Save changes" : "Create booking"}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
