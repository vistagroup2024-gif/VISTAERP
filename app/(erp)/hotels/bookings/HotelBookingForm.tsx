"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { nightsBetween, ROOM_TYPES, ROOM_EXTRA, roomNightly } from "../lib";

interface Opt { id: string; name: string }
interface HotelOpt { id: string; name: string; city: string | null }

const SOURCES = ["Portal", "Phone", "Walk-in", "WhatsApp", "Email", "Agent"];
const MEAL_PLANS = ["Room Only", "Bed & Breakfast", "Half Board", "Full Board"];
const NATIONALITIES = ["Pakistan", "India", "Bangladesh", "Indonesia", "Malaysia", "Nigeria", "Egypt", "Turkey", "United Kingdom", "United States", "Saudi Arabia"];
const CITIES = ["makkah", "madinah", "jeddah", "other"];

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

interface RoomForm {
  room_type: string; meal_plan: string; suite_type: string;
  sale_dbl: number | string; sale_extra: number | string; sale_suite: number | string;
  purchase_dbl: number | string; purchase_extra: number | string; purchase_suite: number | string;
}
interface StayForm {
  id?: string;
  city: string; hotel_id: string; hotel_name: string;
  check_in: string; check_out: string; option_date: string;
  supplier_id: string; supplier_ref: string; notes: string; currency: string;
  rooms_detail: RoomForm[];
}

function blankRoom(): RoomForm {
  return { room_type: "dbl", meal_plan: "", suite_type: "", sale_dbl: "", sale_extra: "", sale_suite: "", purchase_dbl: "", purchase_extra: "", purchase_suite: "" };
}
function blankStay(): StayForm {
  return {
    city: "makkah", hotel_id: "", hotel_name: "", check_in: "", check_out: "", option_date: "",
    supplier_id: "", supplier_ref: "", notes: "", currency: "SAR", rooms_detail: [blankRoom()],
  };
}
function stayFromRow(s: any): StayForm {
  const rooms = Array.isArray(s.rooms_detail) && s.rooms_detail.length
    ? s.rooms_detail.map((r: any) => ({
        room_type: r.room_type ?? "dbl", meal_plan: r.meal_plan ?? "", suite_type: r.suite_type ?? "",
        sale_dbl: r.sale_dbl ?? "", sale_extra: r.sale_extra ?? "", sale_suite: r.sale_suite ?? "",
        purchase_dbl: r.purchase_dbl ?? "", purchase_extra: r.purchase_extra ?? "", purchase_suite: r.purchase_suite ?? "",
      }))
    // Legacy stay without per-room detail: seed one room from the stay's flat rate.
    : Array.from({ length: Math.max(1, Number(s.rooms) || 1) }, () => ({
        room_type: s.room_type && ROOM_EXTRA[s.room_type] !== undefined ? s.room_type : "dbl",
        meal_plan: s.meal_plan ?? "", suite_type: "",
        sale_dbl: s.sale_rate ?? "", sale_extra: "", sale_suite: "",
        purchase_dbl: s.purchase_rate ?? "", purchase_extra: "", purchase_suite: "",
      }));
  return {
    id: s.id,
    city: s.city ?? "makkah", hotel_id: s.hotel_id ?? "", hotel_name: s.hotel_name ?? "",
    check_in: s.check_in ?? "", check_out: s.check_out ?? "", option_date: s.option_date ?? "",
    supplier_id: s.supplier_id ?? "", supplier_ref: s.supplier_ref ?? "", notes: s.notes ?? "",
    currency: s.currency ?? "SAR", rooms_detail: rooms,
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

  const setRoom = (si: number, ri: number, k: keyof RoomForm, v: any) =>
    setStays((arr) => arr.map((s, idx) => idx !== si ? s : { ...s, rooms_detail: s.rooms_detail.map((r, j) => j === ri ? { ...r, [k]: v } : r) }));
  const addRoom = (si: number) => setStays((arr) => arr.map((s, idx) => idx === si ? { ...s, rooms_detail: [...s.rooms_detail, blankRoom()] } : s));
  const removeRoom = (si: number, ri: number) => setStays((arr) => arr.map((s, idx) => idx === si ? { ...s, rooms_detail: s.rooms_detail.length > 1 ? s.rooms_detail.filter((_, j) => j !== ri) : s.rooms_detail } : s));

  function nightsOf(s: StayForm) { return nightsBetween(s.check_in, s.check_out); }
  function staySaleNightly(s: StayForm) { return s.rooms_detail.reduce((a, r) => a + roomNightly(r, "sale"), 0); }
  function stayPurchNightly(s: StayForm) { return s.rooms_detail.reduce((a, r) => a + roomNightly(r, "purchase"), 0); }
  function saleTotalOf(s: StayForm) { return staySaleNightly(s) * nightsOf(s); }
  function purchaseTotalOf(s: StayForm) { return stayPurchNightly(s) * nightsOf(s); }

  const grandSale = useMemo(() => stays.reduce((a, s) => a + saleTotalOf(s), 0), [stays]);
  const grandPurchase = useMemo(() => stays.reduce((a, s) => a + purchaseTotalOf(s), 0), [stays]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const header = { ...h, guests: String(h.guests) };
    const payloadStays = stays.map((s, i) => {
      const first = s.rooms_detail[0];
      return {
        id: s.id,
        city: s.city,
        hotel_id: s.hotel_id,
        hotel_name: s.hotel_id ? (hotels.find((x) => x.id === s.hotel_id)?.name ?? "") : s.hotel_name,
        room_type: first?.room_type ?? "dbl",
        meal_plan: first?.meal_plan ?? "",
        check_in: s.check_in,
        check_out: s.check_out,
        option_date: s.option_date,
        rooms: String(s.rooms_detail.length || 1),
        sale_rate: String(staySaleNightly(s)),
        sale_total: String(saleTotalOf(s)),
        supplier_id: s.supplier_id,
        purchase_rate: String(stayPurchNightly(s)),
        purchase_total: String(purchaseTotalOf(s)),
        currency: s.currency || "SAR",
        supplier_ref: s.supplier_ref,
        notes: s.notes,
        sort: String(i),
        rooms_detail: s.rooms_detail.map((r) => ({
          room_type: r.room_type, meal_plan: r.meal_plan, suite_type: r.suite_type,
          sale_dbl: String(r.sale_dbl || 0), sale_extra: String(r.sale_extra || 0), sale_suite: String(r.sale_suite || 0),
          purchase_dbl: String(r.purchase_dbl || 0), purchase_extra: String(r.purchase_extra || 0), purchase_suite: String(r.purchase_suite || 0),
        })),
      };
    });
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
                  <button type="button" className="text-sm text-red-500 hover:underline" onClick={() => removeStay(i)}>Remove stay</button>
                )}
              </div>

              {/* Stay-level: hotel, dates, option date */}
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="label">City</label>
                  <select className="input" value={s.city} onChange={(e) => setStay(i, "city", e.target.value)}>
                    {CITIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Hotel</label>
                  <select required className="input" value={s.hotel_id} onChange={(e) => setStay(i, "hotel_id", e.target.value)}>
                    <option value="">— Select hotel —</option>
                    {hotels.filter((x) => !s.city || !x.city || x.city === s.city).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Option Date <span className="text-slate-400">(customer due)</span></label><input type="date" className="input" value={s.option_date} onChange={(e) => setStay(i, "option_date", e.target.value)} /></div>
                <div><label className="label">Check-in *</label><input required type="date" className="input" value={s.check_in} onChange={(e) => setStay(i, "check_in", e.target.value)} /></div>
                <div><label className="label">Check-out *</label><input required type="date" className="input" value={s.check_out} onChange={(e) => setStay(i, "check_out", e.target.value)} /></div>
                <div><label className="label">Nights (auto)</label><input className="input bg-slate-50" value={nights} readOnly /></div>
              </div>

              {/* Rooms — each independent */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rooms ({s.rooms_detail.length})</span>
                  <button type="button" className="btn-outline text-xs" onClick={() => addRoom(i)}>+ Add room</button>
                </div>
                {s.rooms_detail.map((r, ri) => {
                  const isSuite = r.room_type === "suite";
                  const extras = ROOM_EXTRA[r.room_type] ?? 0;
                  const saleN = roomNightly(r, "sale");
                  const purchN = roomNightly(r, "purchase");
                  return (
                    <div key={ri} className="rounded-md border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500">Room {ri + 1}</span>
                        {s.rooms_detail.length > 1 && <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => removeRoom(i, ri)}>Remove</button>}
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <label className="label">Room Type</label>
                          <select className="input" value={r.room_type} onChange={(e) => setRoom(i, ri, "room_type", e.target.value)}>
                            {ROOM_TYPES.map((rt) => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
                          </select>
                        </div>
                        <Combo label="Meal Plan" value={r.meal_plan} onChange={(v) => setRoom(i, ri, "meal_plan", v)} options={MEAL_PLANS} listId={`dl-mp-${i}-${ri}`} placeholder="Select or type" />
                        {isSuite && <div><label className="label">Suite Type</label><input className="input" value={r.suite_type} placeholder="e.g. Junior Suite" onChange={(e) => setRoom(i, ri, "suite_type", e.target.value)} /></div>}
                      </div>

                      {/* Sale pricing */}
                      <div className="mt-3 rounded bg-emerald-50/60 p-2">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Sale / night</div>
                        <div className="grid gap-3 md:grid-cols-3">
                          {isSuite
                            ? <div><label className="label">Suite Rate</label><input type="number" step="0.01" className="input" value={r.sale_suite} onChange={(e) => setRoom(i, ri, "sale_suite", e.target.value)} /></div>
                            : <>
                                <div><label className="label">DBL Rate</label><input type="number" step="0.01" className="input" value={r.sale_dbl} onChange={(e) => setRoom(i, ri, "sale_dbl", e.target.value)} /></div>
                                <div><label className="label">Extra Bed {extras ? `(×${extras})` : ""}</label><input type="number" step="0.01" className="input" disabled={!extras} value={r.sale_extra} onChange={(e) => setRoom(i, ri, "sale_extra", e.target.value)} /></div>
                              </>}
                          <div className="flex items-end text-sm text-emerald-700">= {money(saleN, "SAR")}/night</div>
                        </div>
                      </div>

                      {/* Purchase pricing */}
                      <div className="mt-2 rounded bg-slate-50 p-2">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Purchase / night</div>
                        <div className="grid gap-3 md:grid-cols-3">
                          {isSuite
                            ? <div><label className="label">Suite Rate</label><input type="number" step="0.01" className="input" value={r.purchase_suite} onChange={(e) => setRoom(i, ri, "purchase_suite", e.target.value)} /></div>
                            : <>
                                <div><label className="label">DBL Rate</label><input type="number" step="0.01" className="input" value={r.purchase_dbl} onChange={(e) => setRoom(i, ri, "purchase_dbl", e.target.value)} /></div>
                                <div><label className="label">Extra Bed {extras ? `(×${extras})` : ""}</label><input type="number" step="0.01" className="input" disabled={!extras} value={r.purchase_extra} onChange={(e) => setRoom(i, ri, "purchase_extra", e.target.value)} /></div>
                              </>}
                          <div className="flex items-end text-sm text-slate-500">= {money(purchN, "SAR")}/night</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Vendor + stay totals */}
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="label">Vendor / Supplier</label>
                  <select className="input" value={s.supplier_id} onChange={(e) => setStay(i, "supplier_id", e.target.value)}>
                    <option value="">— Select —</option>
                    {suppliers.map((sup) => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Supplier Reference</label><input className="input" value={s.supplier_ref} onChange={(e) => setStay(i, "supplier_ref", e.target.value)} /></div>
                <div className="flex items-end justify-end gap-4 text-sm">
                  <span className="text-slate-500">Purchase: <b>{money(purchaseTotalOf(s), "SAR")}</b></span>
                  <span>Sale: <b className="text-emerald-700">{money(saleTotalOf(s), "SAR")}</b></span>
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
