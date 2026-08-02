"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CountrySelect from "@/components/CountrySelect";
import AttachmentsPanel from "@/components/AttachmentsPanel";

interface Route { id: string; name: string; is_airport?: boolean; from_location?: string | null; to_location?: string | null }
interface Vehicle { id: string; name: string; seating_capacity?: number | null }
interface PkgLeg { seq: number; route_id: string | null; label: string | null; vehicle_id: string | null }
interface Pkg { id: string; name: string; price: number; package_type: string; legs: PkgLeg[] }
interface Rate { agent_id: string | null; route_id: string; vehicle_id: string; sell_rate: number }
interface PkgPrice { package_id: string; vehicle_id: string; price: number }
interface ExtraCharge { route_id: string; vehicle_id: string; desc: string | null; amount: number }
interface Company { id: string; name: string }
interface Agent { id: string; agency_name: string }

interface Trip {
  id: string; route_id: string; route_label: string; vehicle_id: string; trip_date: string; trip_time: string;
  pickup_location: string; drop_location: string; flight_no: string; remarks: string;
  hajj_terminal: boolean; passenger_visa_type: string; status?: string;
}

const VISA_TYPES: [string, string][] = [["umrah", "Umrah Visa"], ["visit", "Visit Visa"], ["other", "Other"]];
const todayStr = () => new Date().toISOString().slice(0, 10);
const blankTrip = (): Trip => ({ id: "", route_id: "", route_label: "", vehicle_id: "", trip_date: "", trip_time: "", pickup_location: "", drop_location: "", flight_no: "", remarks: "", hajj_terminal: false, passenger_visa_type: "" });
const TYPE_LABEL: Record<string, string> = { with_ziyarat: "With Ziyarat", without_ziyarat: "Without Ziyarat" };

export default function TransportBookingForm({
  existing, existingTrips, routes, vehicles, packages, rates, packagePrices = [], extraCharges = [], agents,
  variant = "admin", endpoint, basePath = "/transport/bookings",
}: {
  existing: any | null; existingTrips: any[];
  routes: Route[]; vehicles: Vehicle[]; packages: Pkg[]; rates: Rate[]; packagePrices?: PkgPrice[]; extraCharges?: ExtraCharge[]; companies?: Company[]; agents: Agent[];
  variant?: "admin" | "agent"; endpoint?: string; basePath?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!existing;
  const isAgent = variant === "agent";

  const pkgPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    packagePrices.forEach((p) => m.set(`${p.package_id}|${p.vehicle_id}`, Number(p.price)));
    return m;
  }, [packagePrices]);
  const routeById = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const extraMap = useMemo(() => {
    const m = new Map<string, ExtraCharge>();
    extraCharges.forEach((e) => m.set(`${e.route_id}|${e.vehicle_id}`, e));
    return m;
  }, [extraCharges]);
  const routeName = (id: string) => routeById.get(id)?.name ?? "";
  const isAirportRoute = (t: Trip) => {
    const r = t.route_id ? routeById.get(t.route_id) : undefined;
    const label = (r?.name ?? t.route_label ?? "").toLowerCase();
    return !!r?.is_airport || label.includes("airport");
  };
  // Pickup happens AT the airport (i.e. an airport arrival) when the route's
  // origin is an airport. Jeddah airport pickups additionally offer Hajj Terminal.
  const isAirportArrival = (t: Trip) => {
    const r = t.route_id ? routeById.get(t.route_id) : undefined;
    const from = (r?.from_location ?? "").toLowerCase();
    return from.includes("airport");
  };
  const isJeddahAirportPickup = (t: Trip) => {
    const r = t.route_id ? routeById.get(t.route_id) : undefined;
    const from = (r?.from_location ?? "").toLowerCase();
    return from.includes("airport") && from.includes("jeddah");
  };
  const hajjChargeFor = (t: Trip) => {
    const veh = type === "package" ? pkgVehicleId : t.vehicle_id;
    return t.route_id && veh ? (extraMap.get(`${t.route_id}|${veh}`)?.amount ?? 0) : 0;
  };

  const [type, setType] = useState<string>(existing?.booking_type ?? "single");
  const [packageId, setPackageId] = useState<string>(existing?.package_id ?? "");
  const [pkgVehicleId, setPkgVehicleId] = useState<string>("");
  const [h, setH] = useState({
    agent_id: existing?.agent_id ?? "", group_company_id: existing?.group_company_id ?? "",
    booking_date: existing?.booking_date ?? todayStr(),
    pax: existing?.pax?.toString() ?? "", nusuk_group_no: existing?.nusuk_group_no ?? "",
    passenger_name: existing?.passenger_name ?? "", mobile: existing?.mobile ?? "",
    whatsapp: existing?.whatsapp ?? "", nationality: existing?.nationality ?? "", remarks: existing?.remarks ?? "",
  });

  // Rate per route|vehicle for the SELECTED agent (agent-specific overrides the
  // default), mirroring the server so the live total matches what is saved.
  const rateMap = useMemo(() => {
    const m = new Map<string, number>();
    // Default / pre-resolved rows (no agent_id, e.g. the agent portal already
    // resolves the agent's rate server-side) form the base.
    rates.forEach((r) => { if ((r.agent_id ?? null) === null) m.set(`${r.route_id}|${r.vehicle_id}`, Number(r.sell_rate)); });
    // Then the selected agent's specific rows override, matching the server.
    if (h.agent_id) rates.forEach((r) => { if (r.agent_id === h.agent_id) m.set(`${r.route_id}|${r.vehicle_id}`, Number(r.sell_rate)); });
    return m;
  }, [rates, h.agent_id]);

  // Staff-only manual discount (SAR) off the calculated total.
  const [discount, setDiscount] = useState<string>(existing?.discount ? String(existing.discount) : "");
  const [trips, setTrips] = useState<Trip[]>(
    existingTrips.length
      ? existingTrips.map((t) => ({
          id: t.id ?? "", route_id: t.route_id ?? "", route_label: t.route_label ?? "",
          // Always edit the ORIGINAL booked vehicle, never an operational upgrade
          // (assigning a larger car in Operations must not rewrite the booking).
          vehicle_id: t.requested_vehicle_id ?? t.vehicle_id ?? "",
          trip_date: t.trip_date ?? "", trip_time: t.trip_time?.slice(0, 5) ?? "", pickup_location: t.pickup_location ?? "",
          drop_location: t.drop_location ?? "", flight_no: t.flight_no ?? "", remarks: t.remarks ?? "",
          hajj_terminal: !!t.hajj_terminal, passenger_visa_type: t.passenger_visa_type ?? "", status: t.status ?? "",
        }))
      : [blankTrip()]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalPax = Number(h.pax) || 0;

  function setTrip(i: number, patch: Partial<Trip>) {
    setTrips((ts) => ts.map((t, idx) => {
      if (idx !== i) return t;
      const next = { ...t, ...patch };
      if ("route_id" in patch && next.route_id) next.route_label = routeName(next.route_id) || next.route_label;
      return next;
    }));
  }

  function pickPackage(pid: string) {
    setPackageId(pid);
    setPkgVehicleId("");
    setTrips([]); // trips are generated once a vehicle is chosen
  }
  function pickPkgVehicle(vid: string) {
    setPkgVehicleId(vid);
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) { setTrips([]); return; }
    const legs = [...pkg.legs].sort((a, b) => a.seq - b.seq);
    setTrips(legs.length ? legs.map((l) => ({
      ...blankTrip(),
      route_id: l.route_id ?? "", route_label: l.route_id ? routeName(l.route_id) : (l.label ?? ""),
    })) : [blankTrip()]);
  }

  function changeType(next: string) {
    setType(next);
    if (next === "single") setTrips((ts) => [ts[0] ?? blankTrip()]);
    if (next === "multiple" && trips.length === 0) setTrips([blankTrip()]);
    if (next === "package") { setTrips(packageId && pkgVehicleId ? trips : []); }
  }

  // Total booking amount (auto): package price for the chosen vehicle, else the
  // sum of each trip's route+vehicle rate.
  const total = useMemo(() => {
    const base = type === "package"
      ? (packageId && pkgVehicleId ? (pkgPriceMap.get(`${packageId}|${pkgVehicleId}`) ?? 0) : 0)
      : trips.reduce((s, t) => s + (t.route_id && t.vehicle_id ? (rateMap.get(`${t.route_id}|${t.vehicle_id}`) ?? 0) : 0), 0);
    // Hajj Terminal / route extra charges apply per trip when ticked.
    const extras = trips.reduce((s, t) => s + (t.hajj_terminal ? hajjChargeFor(t) : 0), 0);
    return base + extras;
  }, [type, packageId, pkgVehicleId, pkgPriceMap, trips, rateMap, extraMap]);

  const discountVal = isAgent ? 0 : Math.min(Math.max(Number(discount) || 0, 0), total);
  const netTotal = Math.max(0, total - discountVal);

  // Live package fare distribution (admin only): spread the package price across
  // trips by the same discount %, adjusting the last trip for rounding — mirrors
  // the server so the admin sees the internal per-trip fare before saving.
  const pkgDist = useMemo(() => {
    const map = new Map<number, { normal: number; final: number; pct: number }>();
    if (type !== "package" || !pkgVehicleId) return map;
    const pkgPrice = packageId ? (pkgPriceMap.get(`${packageId}|${pkgVehicleId}`) ?? 0) : 0;
    const normals = trips.map((t) => (t.route_id ? (rateMap.get(`${t.route_id}|${pkgVehicleId}`) ?? 0) : 0));
    const normalTotal = normals.reduce((s, n) => s + n, 0);
    const pct = normalTotal > 0 ? (normalTotal - pkgPrice) / normalTotal * 100 : 0;
    const factor = normalTotal > 0 ? pkgPrice / normalTotal : 0;
    const finals = normals.map((n) => Math.round(n * factor * 100) / 100);
    const drift = Math.round((pkgPrice - finals.reduce((s, f) => s + f, 0)) * 100) / 100;
    if (finals.length) finals[finals.length - 1] = Math.round((finals[finals.length - 1] + drift) * 100) / 100;
    normals.forEach((n, i) => map.set(i, { normal: n, final: finals[i], pct }));
    return map;
  }, [type, packageId, pkgVehicleId, pkgPriceMap, rateMap, trips]);

  // Per-trip fare (operational visibility). For packages the booking total is the
  // package price, but each trip still shows its route+vehicle fare.
  const fareFor = (t: Trip) => {
    const veh = type === "package" ? pkgVehicleId : t.vehicle_id;
    return t.route_id && veh ? (rateMap.get(`${t.route_id}|${veh}`) ?? 0) : 0;
  };

  async function save(status: string) {
    // Total passengers is mandatory.
    if (!totalPax || totalPax < 1) { setErr("Total Passengers is required and must be at least 1."); return; }
    for (const t of trips) {
      // Mandatory flight numbers on airport routes.
      if (isAirportRoute(t) && !t.flight_no.trim()) { setErr("Flight Number is required for airport pickup / drop-off trips."); return; }
      // Passenger Visa Type is mandatory for Jeddah airport arrivals.
      if (isJeddahAirportPickup(t) && !t.passenger_visa_type) { setErr("Passenger Visa Type is required for Jeddah Airport arrival trips."); return; }
      // Vehicle capacity must fit the passenger count.
      const veh = type === "package" ? pkgVehicleId : t.vehicle_id;
      const cap = veh ? vehicleById.get(veh)?.seating_capacity : null;
      if (cap != null && totalPax > cap) {
        setErr(`Selected vehicle seats ${cap}, but there are ${totalPax} passengers. Choose a larger vehicle.`); return;
      }
    }
    if (type === "package" && (!packageId || !pkgVehicleId)) { setErr("Select a package and a vehicle."); return; }

    setBusy(true); setErr(null);
    const header: any = {
      ...h, booking_type: type, status, currency: "SAR",
      discount: discountVal,
      package_id: type === "package" ? packageId : "",
      package_vehicle_id: type === "package" ? pkgVehicleId : "",
    };
    const tripPayload = trips.map((t, i) => ({
      ...t, seq: i + 1,
      // single/multiple: rate from the trip's vehicle; package: priced at package level.
      sell_rate: type === "package" ? 0 : (t.route_id && t.vehicle_id ? (rateMap.get(`${t.route_id}|${t.vehicle_id}`) ?? 0) : 0),
    }));

    let ok = false;
    if (endpoint) {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save", id: existing?.id ?? null, header, trips: tripPayload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setBusy(false); return setErr(json.error || "Save failed"); }
      ok = true;
    } else {
      const { error } = await supabase.rpc("transport_save_booking", { p_id: existing?.id ?? null, p_header: header, p_trips: tripPayload });
      if (error) { setBusy(false); return setErr(error.message); }
      ok = true;
    }
    if (ok) { router.push(`${basePath}?created=1`); router.refresh(); }
  }

  const activePackage = packages.find((p) => p.id === packageId);

  return (
    <div className="space-y-5">
      {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* Booking Information */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Booking Information</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div><label className="label">Booking date</label><input className="input" type="date" value={h.booking_date} onChange={(e) => setH({ ...h, booking_date: e.target.value })} /></div>
          {!isAgent && <div><label className="label">Agent</label>
            <select className="input" value={h.agent_id} onChange={(e) => setH({ ...h, agent_id: e.target.value })}>
              <option value="">— direct —</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.agency_name}</option>)}
            </select></div>}
          <div><label className="label">Haji name</label><input className="input" value={h.passenger_name} onChange={(e) => setH({ ...h, passenger_name: e.target.value })} /></div>
          <div><label className="label">Mobile</label><input className="input" value={h.mobile} onChange={(e) => setH({ ...h, mobile: e.target.value })} /></div>
          <div><label className="label">WhatsApp</label><input className="input" value={h.whatsapp} onChange={(e) => setH({ ...h, whatsapp: e.target.value })} /></div>
          <div><label className="label">Total passengers *</label><input className="input" type="number" min="1" value={h.pax} onChange={(e) => setH({ ...h, pax: e.target.value })} /></div>
          <div><label className="label">Nusuk Group Number</label><input className="input" value={h.nusuk_group_no} onChange={(e) => setH({ ...h, nusuk_group_no: e.target.value })} placeholder="optional" /></div>
          <div className="sm:col-span-2"><label className="label">Nationality</label>
            <CountrySelect value={h.nationality} onChange={(v) => setH({ ...h, nationality: v })} /></div>
        </div>
        <div><label className="label">Remarks</label><input className="input" value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></div>
      </section>

      {/* Trip Details */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Trip Details</h2>
        <div className="flex flex-wrap gap-2">
          {[["single", "Single Route"], ["multiple", "Multiple Routes"], ["package", "Package"]].map(([v, lbl]) => (
            <button key={v} type="button" onClick={() => changeType(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${type === v ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{lbl}</button>
          ))}
        </div>

        {type === "package" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="label">Package *</label>
              <select className="input" value={packageId} onChange={(e) => pickPackage(e.target.value)}>
                <option value="">— choose —</option>
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {TYPE_LABEL[p.package_type] ?? p.package_type}</option>)}
              </select></div>
            {packageId && (
              <div><label className="label">Vehicle *</label>
                <select className="input" value={pkgVehicleId} onChange={(e) => pickPkgVehicle(e.target.value)}>
                  <option value="">— choose vehicle —</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                {packageId && pkgVehicleId && !pkgPriceMap.has(`${packageId}|${pkgVehicleId}`) &&
                  <p className="mt-1 text-xs text-amber-600">No price set for this package + vehicle. Set it under Packages.</p>}
              </div>
            )}
            {packageId && pkgVehicleId && (
              <p className="sm:col-span-2 text-xs text-slate-500">
                Trips below are generated from <b>{activePackage?.name}</b>. One vehicle applies to the whole package; complete the operational fields per trip.
              </p>
            )}
          </div>
        )}

        {(type !== "package" || trips.length > 0) && (
          <div className="space-y-2">
            {trips.map((t, i) => {
              const airport = isAirportRoute(t);
              const done = t.status === "completed";
              const showVisa = isAirportArrival(t);
              const showHajj = isJeddahAirportPickup(t);
              return (
                <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-12">
                  <div className="sm:col-span-3"><label className="label">Route</label>
                    {type === "package" ? (
                      <input className="input bg-slate-50" value={t.route_label} readOnly />
                    ) : (
                      <select className="input" value={t.route_id} onChange={(e) => setTrip(i, { route_id: e.target.value })}>
                        <option value="">— select —</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    )}
                  </div>
                  {type !== "package" && (
                    <div className="sm:col-span-2"><label className="label">Vehicle</label>
                      <select className="input" value={t.vehicle_id} onChange={(e) => setTrip(i, { vehicle_id: e.target.value })}>
                        <option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select></div>
                  )}
                  <div className="sm:col-span-2"><label className="label">Date</label><input className={`input ${done ? "bg-slate-100" : ""}`} type="date" value={t.trip_date} disabled={done} title={done ? "Completed trips cannot have their date or time changed." : undefined} onChange={(e) => setTrip(i, { trip_date: e.target.value })} /></div>
                  <div className="sm:col-span-1"><label className="label">Time</label><input className={`input ${done ? "bg-slate-100" : ""}`} type="time" value={t.trip_time} disabled={done} title={done ? "Completed trips cannot have their date or time changed." : undefined} onChange={(e) => setTrip(i, { trip_time: e.target.value })} /></div>
                  <div className="sm:col-span-2"><label className="label">Pickup</label><input className="input" value={t.pickup_location} onChange={(e) => setTrip(i, { pickup_location: e.target.value })} /></div>
                  <div className="sm:col-span-2"><label className="label">Drop</label><input className="input" value={t.drop_location} onChange={(e) => setTrip(i, { drop_location: e.target.value })} /></div>
                  {airport && (
                    <div className="sm:col-span-2"><label className="label">Flight No *</label><input className="input" value={t.flight_no} placeholder="SV-701" onChange={(e) => setTrip(i, { flight_no: e.target.value })} /></div>
                  )}
                  {showVisa && (
                    <div className="sm:col-span-2"><label className="label">Passenger Visa Type *</label>
                      <select className="input" value={t.passenger_visa_type} onChange={(e) => setTrip(i, { passenger_visa_type: e.target.value })}>
                        <option value="">— select —</option>{VISA_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select></div>
                  )}
                  {/* Trip fare is internal — hidden from agents. For packages
                      admins see the distributed fare (+ original & discount %). */}
                  {!isAgent && (
                    <div className="sm:col-span-2"><label className="label">Trip fare</label>
                      <input className="input bg-slate-50" readOnly
                        value={((type === "package" ? (pkgDist.get(i)?.final ?? 0) : fareFor(t)) + (t.hajj_terminal ? hajjChargeFor(t) : 0)).toFixed(2)} />
                      {type === "package" && (pkgDist.get(i)?.pct ?? 0) > 0 && (
                        <p className="text-[11px] text-slate-400">was {pkgDist.get(i)!.normal.toFixed(2)} · −{pkgDist.get(i)!.pct.toFixed(3)}%</p>
                      )}
                    </div>
                  )}
                  <div className="sm:col-span-4"><label className="label">Remarks</label><input className="input" value={t.remarks} onChange={(e) => setTrip(i, { remarks: e.target.value })} /></div>
                  {showHajj && (
                    <label className="flex items-center gap-2 sm:col-span-3 sm:mt-6 text-sm text-slate-600">
                      <input type="checkbox" checked={t.hajj_terminal} onChange={(e) => setTrip(i, { hajj_terminal: e.target.checked })} />
                      Hajj Terminal{hajjChargeFor(t) > 0 && <span className="text-xs text-slate-400">(+{hajjChargeFor(t).toFixed(2)} SAR)</span>}
                    </label>
                  )}
                  {done && <p className="sm:col-span-12 text-xs text-slate-400">This trip is completed — its date and time are locked.</p>}
                  {type === "multiple" && !done && (
                    <div className="flex items-end sm:col-span-2">
                      <button type="button" onClick={() => setTrips((ts) => ts.filter((_, idx) => idx !== i))} className="text-sm text-red-600 hover:underline">Remove</button>
                    </div>
                  )}
                </div>
              );
            })}
            {type === "multiple" && (
              <button type="button" onClick={() => setTrips((ts) => [...ts, blankTrip()])} className="btn-outline text-sm">+ Add trip</button>
            )}
          </div>
        )}
      </section>

      {/* Pricing */}
      <section className="card">
        {isAgent ? (
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Total Booking Amount</h2>
            <span className="text-2xl font-bold text-brand-dark">{total.toFixed(2)} SAR</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>Subtotal</span><span className="font-medium">{total.toFixed(2)} SAR</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <label className="text-slate-600">Discount (SAR)</label>
              <input className="input max-w-[9rem] text-right" type="number" min="0" step="0.01" max={total || undefined}
                placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-2">
              <h2 className="font-semibold text-slate-700">Total Booking Amount</h2>
              <span className="text-2xl font-bold text-brand-dark">{netTotal.toFixed(2)} SAR</span>
            </div>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">Subtotal is calculated automatically from the selected route/package and vehicle, including any route extra charges (e.g. Hajj Terminal).{!isAgent && " Enter a discount to reduce the total."}</p>
      </section>

      {/* Attachments — staff, existing bookings only */}
      {!isAgent && isEdit && existing?.id && (
        <AttachmentsPanel endpoint="/api/transport/attachments" groupId={existing.id} canUpload canDelete
          accept=".pdf,.jpg,.jpeg,.png,.docx,image/jpeg,image/png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy} onClick={() => save(isAgent ? "pending" : "confirmed")}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create booking"}
        </button>
        <button type="button" className="btn-outline" disabled={busy} onClick={() => save("draft")}>Save as draft</button>
        <button type="button" className="btn-outline" onClick={() => router.push(basePath)}>Cancel</button>
      </div>
    </div>
  );
}
