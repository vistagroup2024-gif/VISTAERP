"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import MultiSelectFilter from "@/components/MultiSelectFilter";

interface Trip {
  id: string; booking_id: string; booking_no: string | null; passenger_name: string | null; mobile: string | null;
  pax: number | null; booking_type: string | null; agent_id: string | null; agent_name: string | null;
  route_id: string | null; route_display: string; vehicle_id: string | null; vehicle_name: string | null;
  vehicle_category: string | null; requested_vehicle_id: string | null; requested_vehicle_name: string | null;
  is_upgraded: boolean; is_outsourced: boolean; driver_id: string | null; driver_name: string | null;
  vendor_id: string | null; vendor_name: string | null; trip_time: string | null;
  pickup_location: string | null; drop_location: string | null; flight_no: string | null; status: string;
  sched_s: string | null; sched_e: string | null;
}
interface Driver { id: string; name: string; vehicle_id: string | null; status: string }
interface Vehicle { id: string; name: string; category: string | null; is_active: boolean }
interface Vendor { id: string; name: string }
interface Agent { id: string; agency_name: string }

// Dispatcher status vocabulary. `delayed` and `outsourced` are derived and can
// co-exist with the base status for filtering purposes.
const STATUS_META: Record<string, { label: string; chip: string }> = {
  pending: { label: "Pending Assignment", chip: "bg-amber-100 text-amber-700" },
  assigned: { label: "Assigned", chip: "bg-indigo-100 text-indigo-700" },
  on_route: { label: "Driver En Route", chip: "bg-cyan-100 text-cyan-700" },
  picked_up: { label: "In Progress", chip: "bg-teal-100 text-teal-700" },
  completed: { label: "Completed", chip: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", chip: "bg-red-100 text-red-700" },
  outsource_required: { label: "Outsource Required", chip: "bg-orange-100 text-orange-700" },
  outsourced: { label: "Outsourced", chip: "bg-purple-100 text-purple-700" },
  delayed: { label: "Delayed", chip: "bg-rose-100 text-rose-700" },
};
// Filterable statuses shown in the Status filter (grouped, dispatcher terms).
const STATUS_FILTER: [string, string][] = [
  ["pending", "Pending Assignment"], ["assigned", "Assigned"], ["on_route", "Driver En Route"],
  ["picked_up", "Passenger Picked Up / In Progress"], ["completed", "Completed"], ["cancelled", "Cancelled"],
  ["outsourced", "Outsourced"], ["delayed", "Delayed"],
];
const NEXT_TRIP: Record<string, string> = { assigned: "on_route", on_route: "picked_up", picked_up: "completed" };
const NEXT_LABEL: Record<string, string> = { on_route: "Start", picked_up: "Picked Up", completed: "Complete" };
const REST_MS = 10 * 3600 * 1000;

export default function OperationsBoard({ date, today, trips, drivers, vehicles, vendors, agents }: {
  date: string; today: string; trips: Trip[]; drivers: Driver[]; vehicles: Vehicle[]; vendors: Vendor[]; agents: Agent[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ tripId: string; driverId: string; driverName: string; reason: string } | null>(null);
  const [forceReason, setForceReason] = useState("");

  const [fVehicle, setFVehicle] = useState<string[]>([]);
  const [fDriver, setFDriver] = useState<string[]>([]);
  const [fRoute, setFRoute] = useState<string[]>([]);
  const [fAgent, setFAgent] = useState<string[]>([]);
  const [fManaged, setFManaged] = useState<string[]>([]);
  const [fVendor, setFVendor] = useState<string[]>([]);
  const [fType, setFType] = useState<string[]>([]);
  const [fCategory, setFCategory] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const now = new Date();

  const tomorrow = useMemo(() => {
    const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10);
  }, [today]);

  // ---- Derived helpers -----------------------------------------------------
  const isDelayed = (t: Trip) => !!t.sched_s && new Date(t.sched_s) < now && ["pending", "assigned"].includes(t.status);
  const isOutsourced = (t: Trip) => t.is_outsourced || !!t.vendor_id || ["outsource_required", "outsourced"].includes(t.status);
  function statusKeys(t: Trip): string[] {
    const keys = [t.status];
    if (isOutsourced(t)) keys.push("outsourced");
    if (isDelayed(t)) keys.push("delayed");
    return keys;
  }
  function managedKey(t: Trip) {
    if (t.driver_id) return t.driver_id;
    if (isOutsourced(t)) return "__outsource";
    return "__unassigned";
  }

  // ---- Filter option lists -------------------------------------------------
  const vehicleOpts = useMemo(() => vehicles.map((v) => ({ value: v.id, label: v.name })), [vehicles]);
  const driverOpts = useMemo(() => drivers.filter((d) => d.status === "active").map((d) => ({ value: d.id, label: d.name })), [drivers]);
  const routeOpts = useMemo(() => {
    const seen = new Map<string, string>();
    trips.forEach((t) => { if (t.route_id) seen.set(t.route_id, t.route_display); });
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [trips]);
  const agentOpts = useMemo(() => {
    const list = agents.map((a) => ({ value: a.id, label: a.agency_name }));
    if (trips.some((t) => !t.agent_id)) list.unshift({ value: "__direct", label: "Direct" });
    return list;
  }, [agents, trips]);
  const managedOpts = useMemo(() => ([
    ...drivers.filter((d) => d.status === "active").map((d) => ({ value: d.id, label: d.name })),
    { value: "__outsource", label: "Outsource queue" }, { value: "__unassigned", label: "Unassigned" },
  ]), [drivers]);
  const vendorOpts = useMemo(() => vendors.map((v) => ({ value: v.id, label: v.name })), [vendors]);
  const typeOpts = useMemo(() => {
    const seen = new Set<string>(); trips.forEach((t) => t.booking_type && seen.add(t.booking_type));
    return Array.from(seen).map((v) => ({ value: v, label: v.replace(/_/g, " ") }));
  }, [trips]);
  const categoryOpts = useMemo(() => {
    const seen = new Set<string>(); vehicles.forEach((v) => v.category && seen.add(v.category));
    trips.forEach((t) => t.vehicle_category && seen.add(t.vehicle_category));
    return Array.from(seen).map((v) => ({ value: v, label: v }));
  }, [vehicles, trips]);
  const statusOpts = STATUS_FILTER.map(([value, label]) => ({ value, label }));

  const filtersActive = fVehicle.length + fDriver.length + fRoute.length + fAgent.length + fManaged.length +
    fVendor.length + fType.length + fCategory.length + fStatus.length + (fromTime ? 1 : 0) + (toTime ? 1 : 0);
  function clearFilters() {
    setFVehicle([]); setFDriver([]); setFRoute([]); setFAgent([]); setFManaged([]);
    setFVendor([]); setFType([]); setFCategory([]); setFStatus([]); setFromTime(""); setToTime("");
  }

  const filtered = useMemo(() => trips.filter((t) => {
    const hhmm = t.trip_time?.slice(0, 5) ?? "";
    return (fVehicle.length === 0 || (t.vehicle_id && fVehicle.includes(t.vehicle_id)) || (t.requested_vehicle_id && fVehicle.includes(t.requested_vehicle_id)))
      && (fDriver.length === 0 || (t.driver_id && fDriver.includes(t.driver_id)))
      && (fRoute.length === 0 || (t.route_id && fRoute.includes(t.route_id)))
      && (fAgent.length === 0 || fAgent.includes(t.agent_id ?? "__direct"))
      && (fManaged.length === 0 || fManaged.includes(managedKey(t)))
      && (fVendor.length === 0 || (t.vendor_id && fVendor.includes(t.vendor_id)))
      && (fType.length === 0 || (t.booking_type && fType.includes(t.booking_type)))
      && (fCategory.length === 0 || (t.vehicle_category && fCategory.includes(t.vehicle_category)))
      && (fStatus.length === 0 || statusKeys(t).some((k) => fStatus.includes(k)))
      && (!fromTime || (hhmm && hhmm >= fromTime))
      && (!toTime || (hhmm && hhmm <= toTime));
  }), [trips, fVehicle, fDriver, fRoute, fAgent, fManaged, fVendor, fType, fCategory, fStatus, fromTime, toTime]);

  // ---- KPIs ----------------------------------------------------------------
  const kpis = useMemo(() => {
    const live = trips.filter((t) => t.status !== "cancelled");
    const onDutyDrivers = new Set(trips.filter((t) => ["on_route", "picked_up"].includes(t.status) && t.driver_id).map((t) => t.driver_id!));
    const operatingVehicles = new Set(trips.filter((t) => ["on_route", "picked_up"].includes(t.status) && t.vehicle_id).map((t) => t.vehicle_id!));
    // In mandatory rest: a driver whose most recent trip ended within the last 10h and isn't currently on duty.
    const restDrivers = new Set<string>();
    drivers.filter((d) => d.status === "active").forEach((d) => {
      if (onDutyDrivers.has(d.id)) return;
      const ends = trips.filter((t) => t.driver_id === d.id && t.sched_e && new Date(t.sched_e) <= now).map((t) => new Date(t.sched_e!).getTime());
      if (ends.length) { const last = Math.max(...ends); if (now.getTime() - last < REST_MS) restDrivers.add(d.id); }
    });
    const activeDrivers = drivers.filter((d) => d.status === "active");
    return {
      total: live.length,
      pending: live.filter((t) => !t.driver_id && !isOutsourced(t) && !["completed"].includes(t.status)).length,
      assigned: live.filter((t) => t.status === "assigned").length,
      inProgress: live.filter((t) => ["on_route", "picked_up"].includes(t.status)).length,
      completed: trips.filter((t) => t.status === "completed").length,
      cancelled: trips.filter((t) => t.status === "cancelled").length,
      outsourced: live.filter(isOutsourced).length,
      delayed: live.filter(isDelayed).length,
      driversOnDuty: onDutyDrivers.size,
      driversRest: restDrivers.size,
      driversAvail: activeDrivers.filter((d) => !onDutyDrivers.has(d.id) && !restDrivers.has(d.id)).length,
      vehiclesOperating: operatingVehicles.size,
      vehiclesAvail: vehicles.filter((v) => v.is_active && !operatingVehicles.has(v.id)).length,
    };
  }, [trips, drivers, vehicles]);

  // ---- Actions -------------------------------------------------------------
  function go(d: string) { router.push(`/transport/operations?date=${d}`); }
  function shift(days: number) { const dt = new Date(date + "T00:00:00"); dt.setDate(dt.getDate() + days); go(dt.toISOString().slice(0, 10)); }

  async function call(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    router.refresh();
    return true;
  }
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

  const KPI = ({ label, value, tone = "" }: { label: string; value: number; tone?: string }) => (
    <div className="card text-center">
      <div className={`text-2xl font-bold ${value && tone ? tone : "text-slate-800"}`}>{value}</div>
      <div className="text-[11px] leading-tight text-slate-500">{label}</div>
    </div>
  );
  const Tab = ({ label, d }: { label: string; d: string }) => (
    <button onClick={() => go(d)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${date === d ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>
  );

  return (
    <div className="space-y-5">
      {/* View tabs + date nav + auto assign */}
      <div className="flex flex-wrap items-center gap-2">
        <Tab label="Today's Trips" d={today} />
        <Tab label="Tomorrow's Trips" d={tomorrow} />
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={() => shift(-1)} className="btn-outline text-sm">←</button>
        <input type="date" className="input max-w-[10rem]" value={date} onChange={(e) => go(e.target.value)} />
        <button onClick={() => shift(1)} className="btn-outline text-sm">→</button>
        <span className="text-sm text-slate-500">{date === today ? "Today" : date === tomorrow ? "Tomorrow" : date}</span>
        <Link href={`/transport/operations/dispatch?date=${date}`} className="btn-outline ml-auto text-sm">📄 Driver Sheets</Link>
        <button onClick={async () => { await call("transport_auto_assign", { p_date: date }); }} disabled={busy} className="btn text-sm">{busy ? "Assigning…" : "⚙ Auto Assign Drivers"}</button>
      </div>
      {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <KPI label="Total Trips" value={kpis.total} />
        <KPI label="Pending Assign" value={kpis.pending} tone="text-amber-600" />
        <KPI label="Assigned" value={kpis.assigned} tone="text-indigo-600" />
        <KPI label="In Progress" value={kpis.inProgress} tone="text-cyan-600" />
        <KPI label="Completed" value={kpis.completed} tone="text-green-600" />
        <KPI label="Cancelled" value={kpis.cancelled} tone="text-red-600" />
        <KPI label="Outsourced" value={kpis.outsourced} tone="text-purple-600" />
        <KPI label="Delayed" value={kpis.delayed} tone="text-rose-600" />
        <KPI label="Drivers Avail." value={kpis.driversAvail} tone="text-green-600" />
        <KPI label="Drivers On Duty" value={kpis.driversOnDuty} tone="text-cyan-600" />
        <KPI label="Drivers Resting" value={kpis.driversRest} tone="text-slate-500" />
        <KPI label="Vehicles Avail." value={kpis.vehiclesAvail} tone="text-green-600" />
        <KPI label="Vehicles Operating" value={kpis.vehiclesOperating} tone="text-cyan-600" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter label="Vehicle" options={vehicleOpts} selected={fVehicle} onChange={setFVehicle} />
        <MultiSelectFilter label="Driver" options={driverOpts} selected={fDriver} onChange={setFDriver} />
        <MultiSelectFilter label="Route" options={routeOpts} selected={fRoute} onChange={setFRoute} />
        <MultiSelectFilter label="Agent" options={agentOpts} selected={fAgent} onChange={setFAgent} />
        <MultiSelectFilter label="Managed By" options={managedOpts} selected={fManaged} onChange={setFManaged} />
        <MultiSelectFilter label="Vendor" options={vendorOpts} selected={fVendor} onChange={setFVendor} />
        <MultiSelectFilter label="Booking Type" options={typeOpts} selected={fType} onChange={setFType} />
        <MultiSelectFilter label="Vehicle Category" options={categoryOpts} selected={fCategory} onChange={setFCategory} />
        <MultiSelectFilter label="Status" options={statusOpts} selected={fStatus} onChange={setFStatus} />
        <div className="flex items-center gap-1 text-sm text-slate-500">
          <span>Time</span>
          <input type="time" className="input max-w-[7rem]" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
          <span>–</span>
          <input type="time" className="input max-w-[7rem]" value={toTime} onChange={(e) => setToTime(e.target.value)} />
        </div>
        {filtersActive > 0 && <button onClick={clearFilters} className="text-sm text-slate-500 hover:underline">Clear filters</button>}
        <span className="ml-auto text-sm text-slate-500">{filtered.length} of {trips.length} trip(s)</span>
      </div>

      {/* Dispatcher table */}
      {trips.length === 0 ? (
        <div className="card text-slate-400">No trips scheduled for this day.</div>
      ) : filtered.length === 0 ? (
        <div className="card text-slate-400">No trips match the current filters.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Booking</th>
                <th className="px-3 py-2">Passenger</th>
                <th className="px-3 py-2">Pax</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Driver / Managed By</th>
                <th className="px-3 py-2">Pickup → Drop</th>
                <th className="px-3 py-2">Flight</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const delayed = isDelayed(t);
                return (
                  <tr key={t.id} className={`border-t border-slate-100 align-top hover:bg-slate-50 ${delayed ? "bg-rose-50/40" : ""}`}>
                    <td className="px-3 py-2 font-semibold text-slate-700">{t.trip_time?.slice(0, 5) ?? "—"}</td>
                    <td className="px-3 py-2"><Link href={`/transport/bookings/${t.booking_id}`} className="font-medium text-brand hover:underline">{t.booking_no ?? "—"}</Link>
                      {t.booking_type && <div className="text-[11px] text-slate-400">{t.booking_type.replace(/_/g, " ")}</div>}</td>
                    <td className="px-3 py-2">{t.passenger_name ?? "—"}{t.mobile && <div className="text-[11px] text-slate-400">{t.mobile}</div>}</td>
                    <td className="px-3 py-2 text-center">{t.pax ?? "—"}</td>
                    <td className="px-3 py-2">{t.agent_name ?? "—"}</td>
                    <td className="px-3 py-2">{t.route_display}</td>
                    <td className="px-3 py-2">
                      <div className="text-slate-700">{t.vehicle_name ?? t.requested_vehicle_name ?? <span className="text-slate-400">—</span>}</div>
                      {t.requested_vehicle_name && t.vehicle_name && t.requested_vehicle_name !== t.vehicle_name && (
                        <div className="text-[11px] text-slate-400">req: {t.requested_vehicle_name}</div>
                      )}
                      {t.is_upgraded && <span className="mt-0.5 inline-block rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">⬆ upgraded</span>}
                    </td>
                    <td className="px-3 py-2">
                      {t.driver_name ? <span className="font-medium text-slate-700">🧑‍✈️ {t.driver_name}</span>
                        : t.vendor_name ? <span className="font-medium text-purple-700">🏢 {t.vendor_name}</span>
                        : isOutsourced(t) ? <span className="text-orange-600">outsource</span>
                        : <span className="text-amber-600">unassigned</span>}
                      {isOutsourced(t) && t.driver_name == null && <span className="ml-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">outsourced</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{[t.pickup_location, t.drop_location].filter(Boolean).join(" → ") || "—"}</td>
                    <td className="px-3 py-2 text-xs">{t.flight_no ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_META[t.status]?.chip ?? "bg-slate-200 text-slate-600"}`}>{STATUS_META[t.status]?.label ?? t.status.replace(/_/g, " ")}</span>
                      {delayed && <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">delayed</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-end gap-2">
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
                        {isOutsourced(t) && vendors.length > 0 && (
                          <select className="input max-w-[10rem] text-sm" value={t.vendor_id ?? ""}
                            onChange={(e) => { if (e.target.value) call("transport_assign_vendor", { p_trip: t.id, p_vendor: e.target.value }); }}>
                            <option value="">Vendor…</option>
                            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                        )}
                        {t.driver_id && t.status !== "completed" && t.status !== "cancelled" && (
                          <button onClick={() => call("transport_unassign_trip", { p_trip: t.id })} className="text-sm text-slate-500 hover:underline">Unassign</button>
                        )}
                        {NEXT_TRIP[t.status] && (
                          <button onClick={() => call("transport_set_trip_status", { p_trip: t.id, p_status: NEXT_TRIP[t.status] })} className="btn text-xs">{NEXT_LABEL[NEXT_TRIP[t.status]]}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {conflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800">⚠ Assignment Conflict</h3>
            <p className="mt-2 text-sm text-slate-600">Assigning <b>{conflict.driverName}</b> to this trip has a conflict:</p>
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{conflict.reason}</div>
            <label className="label mt-3">Reason for override (optional)</label>
            <textarea className="input" rows={2} value={forceReason} onChange={(e) => setForceReason(e.target.value)} placeholder="Why is this override necessary?" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConflict(null)} className="btn-outline text-sm">Cancel</button>
              <button onClick={forceAssign} disabled={busy} className="btn text-sm bg-red-600 hover:bg-red-700">Force Assign</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Force assignments are recorded in the audit log with your name, the time and reason.</p>
          </div>
        </div>
      )}
    </div>
  );
}
