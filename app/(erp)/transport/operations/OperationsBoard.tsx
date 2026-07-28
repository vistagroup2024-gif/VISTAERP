"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import MultiSelectFilter from "@/components/MultiSelectFilter";

interface Trip {
  id: string; booking_id: string; booking_no: string | null; passenger_name: string | null; mobile: string | null;
  route_id: string | null; route_display: string; vehicle_id: string | null; vehicle_name: string | null; requested_vehicle_name: string | null;
  is_upgraded: boolean; driver_id: string | null; driver_name: string | null; vendor_id: string | null; vendor_name: string | null;
  trip_time: string | null; pickup_location: string | null; drop_location: string | null; status: string;
  sched_s: string | null; sched_e: string | null;
}
interface Driver { id: string; name: string; vehicle_id: string | null; status: string }
interface Vehicle { id: string; name: string; is_active: boolean }

const SLOTS: [string, number, number][] = [["Morning", 0, 12], ["Afternoon", 12, 17], ["Evening", 17, 21], ["Night", 21, 24]];
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700", assigned: "bg-indigo-100 text-indigo-700", on_route: "bg-cyan-100 text-cyan-700",
  picked_up: "bg-teal-100 text-teal-700", completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
  outsource_required: "bg-orange-100 text-orange-700", outsourced: "bg-purple-100 text-purple-700",
};
const NEXT_TRIP: Record<string, string> = { assigned: "on_route", on_route: "picked_up", picked_up: "completed" };
const NEXT_LABEL: Record<string, string> = { on_route: "Start (On Route)", picked_up: "Picked Up", completed: "Complete" };

interface Vendor { id: string; name: string }

export default function OperationsBoard({ date, today, trips, drivers, vehicles, vendors }: {
  date: string; today: string; trips: Trip[]; drivers: Driver[]; vehicles: Vehicle[]; vendors: Vendor[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ tripId: string; driverId: string; driverName: string; reason: string } | null>(null);
  const [forceReason, setForceReason] = useState("");
  const [fVehicle, setFVehicle] = useState<string[]>([]);
  const [fRoute, setFRoute] = useState<string[]>([]);
  const [fManaged, setFManaged] = useState<string[]>([]);
  const now = new Date();

  // Filter options (Excel-style). "Managed By" = the assigned driver, or the
  // Outsource queue, or Unassigned.
  const vehicleOpts = useMemo(() => vehicles.map((v) => ({ value: v.id, label: v.name })), [vehicles]);
  const routeOpts = useMemo(() => {
    const seen = new Map<string, string>();
    trips.forEach((t) => { if (t.route_id) seen.set(t.route_id, t.route_display); });
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [trips]);
  const managedOpts = useMemo(() => ([
    ...drivers.filter((d) => d.status === "active").map((d) => ({ value: d.id, label: d.name })),
    { value: "__outsource", label: "Outsource queue" }, { value: "__unassigned", label: "Unassigned" },
  ]), [drivers]);

  function managedKey(t: Trip) {
    if (t.status === "outsource_required") return "__outsource";
    if (t.driver_id) return t.driver_id;
    return "__unassigned";
  }
  const filtered = useMemo(() => trips.filter((t) =>
    (fVehicle.length === 0 || (t.vehicle_id && fVehicle.includes(t.vehicle_id))) &&
    (fRoute.length === 0 || (t.route_id && fRoute.includes(t.route_id))) &&
    (fManaged.length === 0 || fManaged.includes(managedKey(t)))
  ), [trips, fVehicle, fRoute, fManaged]);

  function go(d: string) { router.push(`/transport/operations?date=${d}`); }
  function shift(days: number) {
    const dt = new Date(date + "T00:00:00"); dt.setDate(dt.getDate() + days);
    go(dt.toISOString().slice(0, 10));
  }

  async function call(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    router.refresh();
    return true;
  }

  // Manual assign: check for conflicts first; if any, open the Force-Assign dialog.
  async function tryAssign(tripId: string, driverId: string, driverName: string) {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("transport_assign_check", { p_trip: tripId, p_driver: driverId });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if ((data as any)?.ok) {
      const ok = await call("transport_assign_trip", { p_trip: tripId, p_driver: driverId });
      if (ok) setAssignFor(null);
    } else {
      setConflict({ tripId, driverId, driverName, reason: (data as any)?.reason ?? "Scheduling conflict." });
      setForceReason("");
    }
  }
  async function forceAssign() {
    if (!conflict) return;
    const ok = await call("transport_assign_trip", { p_trip: conflict.tripId, p_driver: conflict.driverId, p_force: true, p_reason: forceReason.trim() || null });
    if (ok) { setConflict(null); setAssignFor(null); }
  }

  const isDelayed = (t: Trip) => t.sched_s && new Date(t.sched_s) < now && ["pending", "assigned"].includes(t.status);

  const kpis = useMemo(() => {
    const live = trips.filter((t) => t.status !== "cancelled");
    return {
      total: live.length,
      pending: live.filter((t) => !t.driver_id && !["completed", "outsource_required"].includes(t.status)).length,
      inProgress: live.filter((t) => ["on_route", "picked_up"].includes(t.status)).length,
      delayed: live.filter(isDelayed).length,
      outsource: live.filter((t) => t.status === "outsource_required").length,
      completed: trips.filter((t) => t.status === "completed").length,
      driversAvail: drivers.filter((d) => d.status === "active").length,
      vehiclesAvail: vehicles.filter((v) => v.is_active).length,
    };
  }, [trips, drivers, vehicles]);

  function slotOf(t: Trip) {
    if (!t.trip_time) return SLOTS.length - 1;
    const h = Number(t.trip_time.slice(0, 2));
    return SLOTS.findIndex(([, a, b]) => h >= a && h < b);
  }

  const KPI = ({ label, value, tone = "" }: { label: string; value: number; tone?: string }) => (
    <div className="card text-center">
      <div className={`text-2xl font-bold ${tone || "text-slate-800"}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Date nav + auto assign */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => shift(-1)} className="btn-outline text-sm">←</button>
        <input type="date" className="input max-w-[10rem]" value={date} onChange={(e) => go(e.target.value)} />
        <button onClick={() => shift(1)} className="btn-outline text-sm">→</button>
        {date !== today && <button onClick={() => go(today)} className="btn-outline text-sm">Today</button>}
        <span className="text-sm text-slate-500">{date === today ? "Today" : date}</span>
        <Link href={`/transport/operations/dispatch?date=${date}`} className="btn-outline ml-auto text-sm">📄 Driver Sheets</Link>
        <button onClick={async () => { await call("transport_auto_assign", { p_date: date }); }} disabled={busy}
          className="btn text-sm">{busy ? "Assigning…" : "⚙ Auto Assign Drivers"}</button>
      </div>
      {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KPI label="Trips" value={kpis.total} />
        <KPI label="Pending Assign" value={kpis.pending} tone={kpis.pending ? "text-amber-600" : ""} />
        <KPI label="In Progress" value={kpis.inProgress} tone="text-cyan-600" />
        <KPI label="Delayed" value={kpis.delayed} tone={kpis.delayed ? "text-red-600" : ""} />
        <KPI label="Outsource Req." value={kpis.outsource} tone={kpis.outsource ? "text-orange-600" : ""} />
        <KPI label="Completed" value={kpis.completed} tone="text-green-600" />
        <KPI label="Drivers" value={kpis.driversAvail} />
        <KPI label="Vehicles" value={kpis.vehiclesAvail} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter label="Vehicle" options={vehicleOpts} selected={fVehicle} onChange={setFVehicle} />
        <MultiSelectFilter label="Route" options={routeOpts} selected={fRoute} onChange={setFRoute} />
        <MultiSelectFilter label="Managed By" options={managedOpts} selected={fManaged} onChange={setFManaged} />
        {(fVehicle.length || fRoute.length || fManaged.length) > 0 && (
          <button onClick={() => { setFVehicle([]); setFRoute([]); setFManaged([]); }} className="text-sm text-slate-500 hover:underline">Clear filters</button>
        )}
        <span className="ml-auto text-sm text-slate-500">{filtered.length} of {trips.length} trip(s)</span>
      </div>

      {/* Timeline */}
      {trips.length === 0 ? (
        <div className="card text-slate-400">No trips scheduled for this day.</div>
      ) : filtered.length === 0 ? (
        <div className="card text-slate-400">No trips match the current filters.</div>
      ) : (
        <div className="space-y-4">
          {SLOTS.map(([name], si) => {
            const rows = filtered.filter((t) => slotOf(t) === si);
            if (!rows.length) return null;
            return (
              <div key={name}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{name}</p>
                <div className="space-y-2">
                  {rows.map((t) => (
                    <div key={t.id} className={`card flex flex-wrap items-center gap-x-4 gap-y-2 ${isDelayed(t) ? "border-l-4 border-red-400" : ""}`}>
                      <div className="w-14 shrink-0 text-sm font-semibold text-slate-700">{t.trip_time?.slice(0, 5) ?? "—"}</div>
                      <div className="min-w-[9rem] flex-1">
                        <Link href={`/transport/bookings/${t.booking_id}`} className="text-sm font-medium text-brand hover:underline">{t.booking_no ?? "Booking"}</Link>
                        <div className="text-xs text-slate-500">{t.passenger_name ?? "—"} · {t.route_display}</div>
                        <div className="text-xs text-slate-400">{[t.pickup_location, t.drop_location].filter(Boolean).join(" → ") || ""}</div>
                      </div>
                      <div className="text-sm text-slate-600">
                        {t.vehicle_name ?? t.requested_vehicle_name ?? <span className="text-slate-400">no vehicle</span>}
                        {t.is_upgraded && t.requested_vehicle_name && (
                          <span className="ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700" title={`Upgraded from ${t.requested_vehicle_name}`}>⬆ upgraded</span>
                        )}
                      </div>
                      <div className="text-sm">
                        {t.driver_name
                          ? <span className="font-medium text-slate-700">🧑‍✈️ {t.driver_name}</span>
                          : t.vendor_name
                          ? <span className="font-medium text-purple-700">🏢 {t.vendor_name}</span>
                          : t.status === "outsource_required"
                          ? <span className="text-orange-600">outsource</span>
                          : <span className="text-amber-600">unassigned</span>}
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[t.status] ?? "bg-slate-200"}`}>{t.status.replace("_", " ")}</span>

                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        {t.status !== "cancelled" && t.status !== "completed" && (
                          assignFor === t.id ? (
                            <select className="input max-w-[11rem] text-sm" defaultValue=""
                              onChange={(e) => { if (e.target.value) { const d = drivers.find((x) => x.id === e.target.value); tryAssign(t.id, e.target.value, d?.name ?? "driver"); } }}>
                              <option value="">Choose driver…</option>
                              {drivers.filter((d) => d.status === "active").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                          ) : (
                            <button onClick={() => setAssignFor(t.id)} className="text-sm text-brand hover:underline">{t.driver_id ? "Reassign" : "Assign"}</button>
                          )
                        )}
                        {(t.status === "outsource_required" || t.status === "outsourced") && vendors.length > 0 && (
                          <select className="input max-w-[10rem] text-sm" value={t.vendor_id ?? ""}
                            onChange={(e) => { if (e.target.value) call("transport_assign_vendor", { p_trip: t.id, p_vendor: e.target.value }); }}>
                            <option value="">Assign vendor…</option>
                            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                        )}
                        {t.driver_id && t.status !== "completed" && t.status !== "cancelled" && (
                          <button onClick={() => call("transport_unassign_trip", { p_trip: t.id })} className="text-sm text-slate-500 hover:underline">Unassign</button>
                        )}
                        {NEXT_TRIP[t.status] && (
                          <button onClick={() => call("transport_set_trip_status", { p_trip: t.id, p_status: NEXT_TRIP[t.status] })}
                            className="btn text-xs">{NEXT_LABEL[NEXT_TRIP[t.status]]}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {conflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800">⚠ Assignment Conflict</h3>
            <p className="mt-2 text-sm text-slate-600">
              Assigning <b>{conflict.driverName}</b> to this trip has a conflict:
            </p>
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{conflict.reason}</div>
            <label className="label mt-3">Reason for override (optional)</label>
            <textarea className="input" rows={2} value={forceReason} onChange={(e) => setForceReason(e.target.value)} placeholder="Why is this override necessary?" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConflict(null)} className="btn-outline text-sm">Cancel Assignment</button>
              <button onClick={forceAssign} disabled={busy} className="btn text-sm bg-red-600 hover:bg-red-700">Force Assign</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Force assignments are recorded in the audit log with your name, the time and reason.</p>
          </div>
        </div>
      )}
    </div>
  );
}
