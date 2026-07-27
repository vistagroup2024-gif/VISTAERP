"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Route { id: string; name: string }
interface Vehicle { id: string; name: string }
interface PkgLeg { seq: number; route_id: string | null; label: string | null; vehicle_id: string | null }
interface Pkg { id: string; name: string; price: number; package_type: string; legs: PkgLeg[] }
interface Rate { route_id: string; vehicle_id: string; sell_rate: number }
interface Company { id: string; name: string }
interface Agent { id: string; agency_name: string }

interface Trip {
  route_id: string; route_label: string; vehicle_id: string; trip_date: string; trip_time: string;
  pickup_location: string; drop_location: string; sell_rate: string; remarks: string;
}

const blankTrip = (): Trip => ({ route_id: "", route_label: "", vehicle_id: "", trip_date: "", trip_time: "", pickup_location: "", drop_location: "", sell_rate: "", remarks: "" });

export default function TransportBookingForm({
  existing, existingTrips, routes, vehicles, packages, rates, companies, agents,
  variant = "admin", endpoint, basePath = "/transport/bookings",
}: {
  existing: any | null; existingTrips: any[];
  routes: Route[]; vehicles: Vehicle[]; packages: Pkg[]; rates: Rate[]; companies: Company[]; agents: Agent[];
  variant?: "admin" | "agent"; endpoint?: string; basePath?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!existing;
  const isAgent = variant === "agent";

  const rateMap = useMemo(() => {
    const m = new Map<string, number>();
    rates.forEach((r) => m.set(`${r.route_id}|${r.vehicle_id}`, Number(r.sell_rate)));
    return m;
  }, [rates]);
  const routeName = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes]);

  const [type, setType] = useState<string>(existing?.booking_type ?? "single");
  const [packageId, setPackageId] = useState<string>(existing?.package_id ?? "");
  const [h, setH] = useState({
    agent_id: existing?.agent_id ?? "", group_company_id: existing?.group_company_id ?? "",
    booking_date: existing?.booking_date ?? "", pax: existing?.pax?.toString() ?? "",
    passenger_name: existing?.passenger_name ?? "", primary_contact: existing?.primary_contact ?? "",
    mobile: existing?.mobile ?? "", whatsapp: existing?.whatsapp ?? "", nationality: existing?.nationality ?? "",
    remarks: existing?.remarks ?? "", arrival_flight: existing?.arrival_flight ?? "", arrival_date: existing?.arrival_date ?? "",
    arrival_time: existing?.arrival_time?.slice(0, 5) ?? "", departure_flight: existing?.departure_flight ?? "",
    departure_date: existing?.departure_date ?? "", departure_time: existing?.departure_time?.slice(0, 5) ?? "",
    discount: existing?.discount?.toString() ?? "", additional_charges: existing?.additional_charges?.toString() ?? "",
  });
  const [trips, setTrips] = useState<Trip[]>(
    existingTrips.length
      ? existingTrips.map((t) => ({
          route_id: t.route_id ?? "", route_label: t.route_label ?? "", vehicle_id: t.vehicle_id ?? "",
          trip_date: t.trip_date ?? "", trip_time: t.trip_time?.slice(0, 5) ?? "", pickup_location: t.pickup_location ?? "",
          drop_location: t.drop_location ?? "", sell_rate: t.sell_rate?.toString() ?? "", remarks: t.remarks ?? "",
        }))
      : [blankTrip()]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setTrip(i: number, patch: Partial<Trip>) {
    setTrips((ts) => ts.map((t, idx) => {
      if (idx !== i) return t;
      const next = { ...t, ...patch };
      // auto-fill rate + label when route/vehicle change
      if (("route_id" in patch || "vehicle_id" in patch) && next.route_id && next.vehicle_id) {
        const r = rateMap.get(`${next.route_id}|${next.vehicle_id}`);
        if (r != null) next.sell_rate = String(r);
      }
      if ("route_id" in patch && next.route_id) next.route_label = routeName.get(next.route_id) ?? next.route_label;
      return next;
    }));
  }

  function pickPackage(pid: string) {
    setPackageId(pid);
    const pkg = packages.find((p) => p.id === pid);
    if (!pkg) { setTrips([blankTrip()]); return; }
    const defVeh = "";
    const legs = [...pkg.legs].sort((a, b) => a.seq - b.seq);
    setTrips(legs.length ? legs.map((l) => ({
      ...blankTrip(),
      route_id: l.route_id ?? "", route_label: l.route_id ? (routeName.get(l.route_id) ?? "") : (l.label ?? ""),
      vehicle_id: l.vehicle_id ?? defVeh,
    })) : [blankTrip()]);
  }

  function changeType(next: string) {
    setType(next);
    if (next === "single") setTrips((ts) => [ts[0] ?? blankTrip()]);
    if (next === "package" && packageId) pickPackage(packageId);
    if (next === "package" && !packageId) setTrips([]);
  }

  const sellPrice = useMemo(() => {
    if (type === "package") return Number(packages.find((p) => p.id === packageId)?.price ?? 0);
    return trips.reduce((s, t) => s + (Number(t.sell_rate) || 0), 0);
  }, [type, packageId, packages, trips]);
  const discount = Number(h.discount) || 0;
  const additional = Number(h.additional_charges) || 0;
  const net = sellPrice - discount;
  const total = net + additional;

  async function save(status: string) {
    setBusy(true); setErr(null);
    const header = { ...h, booking_type: type, package_id: type === "package" ? packageId : "", status, currency: "SAR" };
    const tripPayload = trips.map((t, i) => ({ ...t, seq: i + 1 }));
    let newId: string | null = null;
    if (endpoint) {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save", id: existing?.id ?? null, header, trips: tripPayload }),
      });
      const json = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) return setErr(json.error || "Save failed");
      newId = json.id;
    } else {
      const { data, error } = await supabase.rpc("transport_save_booking", {
        p_id: existing?.id ?? null, p_header: header, p_trips: tripPayload,
      });
      setBusy(false);
      if (error) return setErr(error.message);
      newId = data;
    }
    router.push(`${basePath}/${newId}`);
    router.refresh();
  }

  const showTrips = type !== "package" || trips.length > 0;

  return (
    <div className="space-y-5">
      {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* Passenger & agent */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Passenger &amp; Booking</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {!isAgent && <div><label className="label">Agent</label>
            <select className="input" value={h.agent_id} onChange={(e) => setH({ ...h, agent_id: e.target.value })}>
              <option value="">— direct —</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.agency_name}</option>)}
            </select></div>}
          {!isAgent && <div><label className="label">Company</label>
            <select className="input" value={h.group_company_id} onChange={(e) => setH({ ...h, group_company_id: e.target.value })}>
              <option value="">— none —</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>}
          <div><label className="label">Booking date</label><input className="input" type="date" value={h.booking_date} onChange={(e) => setH({ ...h, booking_date: e.target.value })} /></div>
          <div><label className="label">Passengers</label><input className="input" type="number" min="0" value={h.pax} onChange={(e) => setH({ ...h, pax: e.target.value })} /></div>
          <div><label className="label">Primary contact</label><input className="input" value={h.passenger_name} onChange={(e) => setH({ ...h, passenger_name: e.target.value })} /></div>
          <div><label className="label">Mobile</label><input className="input" value={h.mobile} onChange={(e) => setH({ ...h, mobile: e.target.value })} /></div>
          <div><label className="label">WhatsApp</label><input className="input" value={h.whatsapp} onChange={(e) => setH({ ...h, whatsapp: e.target.value })} /></div>
          <div><label className="label">Nationality</label><input className="input" value={h.nationality} onChange={(e) => setH({ ...h, nationality: e.target.value })} /></div>
        </div>
        <div><label className="label">Remarks</label><input className="input" value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></div>
      </section>

      {/* Travel details */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Travel Details</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className="label">Arrival flight</label><input className="input" value={h.arrival_flight} onChange={(e) => setH({ ...h, arrival_flight: e.target.value })} /></div>
          <div><label className="label">Arrival date</label><input className="input" type="date" value={h.arrival_date} onChange={(e) => setH({ ...h, arrival_date: e.target.value })} /></div>
          <div><label className="label">Arrival time</label><input className="input" type="time" value={h.arrival_time} onChange={(e) => setH({ ...h, arrival_time: e.target.value })} /></div>
          <div><label className="label">Departure flight</label><input className="input" value={h.departure_flight} onChange={(e) => setH({ ...h, departure_flight: e.target.value })} /></div>
          <div><label className="label">Departure date</label><input className="input" type="date" value={h.departure_date} onChange={(e) => setH({ ...h, departure_date: e.target.value })} /></div>
          <div><label className="label">Departure time</label><input className="input" type="time" value={h.departure_time} onChange={(e) => setH({ ...h, departure_time: e.target.value })} /></div>
        </div>
      </section>

      {/* Booking option */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Trips</h2>
        <div className="flex flex-wrap gap-2">
          {[["single", "Single Route"], ["multiple", "Multiple Routes"], ["package", "Package"]].map(([v, lbl]) => (
            <button key={v} type="button" onClick={() => changeType(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${type === v ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{lbl}</button>
          ))}
        </div>

        {type === "package" && (
          <div className="max-w-sm"><label className="label">Select package</label>
            <select className="input" value={packageId} onChange={(e) => pickPackage(e.target.value)}>
              <option value="">— choose —</option>{packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.price} SAR</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">Trips below are inserted from the package. Timing can be adjusted; the price stays the package price.</p>
          </div>
        )}

        {showTrips && (
          <div className="space-y-2">
            {trips.map((t, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-12">
                <div className="sm:col-span-3"><label className="label">Route</label>
                  {type === "package" && t.route_id === "" ? (
                    <input className="input" value={t.route_label} onChange={(e) => setTrip(i, { route_label: e.target.value })} />
                  ) : (
                    <select className="input" value={t.route_id} onChange={(e) => setTrip(i, { route_id: e.target.value })}>
                      <option value="">— select —</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="sm:col-span-2"><label className="label">Vehicle</label>
                  <select className="input" value={t.vehicle_id} onChange={(e) => setTrip(i, { vehicle_id: e.target.value })}>
                    <option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select></div>
                <div className="sm:col-span-2"><label className="label">Date</label><input className="input" type="date" value={t.trip_date} onChange={(e) => setTrip(i, { trip_date: e.target.value })} /></div>
                <div className="sm:col-span-1"><label className="label">Time</label><input className="input" type="time" value={t.trip_time} onChange={(e) => setTrip(i, { trip_time: e.target.value })} /></div>
                <div className="sm:col-span-2"><label className="label">Pickup</label><input className="input" value={t.pickup_location} onChange={(e) => setTrip(i, { pickup_location: e.target.value })} /></div>
                <div className="sm:col-span-2"><label className="label">Drop</label><input className="input" value={t.drop_location} onChange={(e) => setTrip(i, { drop_location: e.target.value })} /></div>
                <div className="sm:col-span-2"><label className="label">Rate (SAR)</label><input className="input" type="number" min="0" step="0.01" value={t.sell_rate} disabled={type === "package"} onChange={(e) => setTrip(i, { sell_rate: e.target.value })} /></div>
                <div className="sm:col-span-9"><label className="label">Remarks</label><input className="input" value={t.remarks} onChange={(e) => setTrip(i, { remarks: e.target.value })} /></div>
                {type !== "single" && (
                  <div className="flex items-end sm:col-span-1">
                    <button type="button" onClick={() => setTrips((ts) => ts.filter((_, idx) => idx !== i))} className="text-sm text-red-600 hover:underline">Remove</button>
                  </div>
                )}
              </div>
            ))}
            {type !== "single" && (
              <button type="button" onClick={() => setTrips((ts) => [...ts, blankTrip()])} className="btn-outline text-sm">+ Add trip</button>
            )}
          </div>
        )}
      </section>

      {/* Pricing */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Pricing</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <div><label className="label">Selling price</label><input className="input bg-slate-50" value={sellPrice.toFixed(2)} readOnly /></div>
          <div><label className="label">Discount</label><input className="input" type="number" min="0" step="0.01" value={h.discount} onChange={(e) => setH({ ...h, discount: e.target.value })} /></div>
          <div><label className="label">Net amount</label><input className="input bg-slate-50" value={net.toFixed(2)} readOnly /></div>
          <div><label className="label">Additional charges</label><input className="input" type="number" min="0" step="0.01" value={h.additional_charges} onChange={(e) => setH({ ...h, additional_charges: e.target.value })} /></div>
          <div><label className="label">Total amount</label><input className="input bg-brand/5 font-semibold" value={total.toFixed(2)} readOnly /></div>
        </div>
        <p className="text-right text-lg font-bold text-slate-800">Total: {total.toFixed(2)} SAR</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-outline" disabled={busy} onClick={() => save("draft")}>{busy ? "Saving…" : "Save as draft"}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => save(isEdit ? (existing.status === "draft" ? "pending" : existing.status) : "pending")}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create booking"}
        </button>
        <button type="button" className="btn-outline" onClick={() => router.push("/transport/bookings")}>Cancel</button>
      </div>
    </div>
  );
}
