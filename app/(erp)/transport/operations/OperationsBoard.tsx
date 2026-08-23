"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import { fmtTime12 } from "@/lib/format";

interface Trip {
  id: string; booking_id: string; booking_no: string | null; passenger_name: string | null; mobile: string | null;
  pax: number | null; booking_type: string | null; agent_id: string | null; agent_name: string | null; whatsapp: string | null;
  route_id: string | null; route_display: string; vehicle_id: string | null; vehicle_name: string | null;
  vehicle_category: string | null; requested_vehicle_id: string | null; requested_vehicle_name: string | null;
  is_upgraded: boolean; is_outsourced: boolean; driver_id: string | null; driver_name: string | null;
  driver_mobile: string | null; driver_reg: string | null; vehicle_type: string | null; hajj_terminal: boolean;
  trip_date: string | null;
  vendor_id: string | null; vendor_name: string | null; trip_time: string | null;
  outsource_driver_name: string | null; outsource_driver_mobile: string | null; sell_rate: number | null; payment_method: string | null; vendor_cost: number | null; cash_received: number | null; collect_amount: number | null; assignment_confirmed?: boolean;
  pickup_location: string | null; drop_location: string | null; flight_no: string | null; status: string;
  sched_s: string | null; sched_e: string | null;
  tafweej_created?: boolean; needs_tafweej?: boolean;
}
interface Driver { id: string; name: string; vehicle_id: string | null; status: string }
interface Vehicle { id: string; name: string; category: string | null; upgrade_rank?: number | null; is_active: boolean }
interface Vendor { id: string; name: string; vendor_type?: string; contact_person?: string | null; mobile?: string | null; vehicle_ids?: string[] | null }
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
// Vendor-managed (outsourced) trips step through the same lifecycle as in-house
// trips, so they also get Start → Picked Up → Complete (not just Complete).
const NEXT_TRIP: Record<string, string> = { assigned: "on_route", outsourced: "on_route", on_route: "picked_up", picked_up: "completed" };
const NEXT_LABEL: Record<string, string> = { on_route: "Start", picked_up: "Picked Up", completed: "Complete" };
const REST_MS = 10 * 3600 * 1000;
// Money is shown as whole SAR (no fractional riyals) across the operations board.
const sar = (n: any) => Math.round(Number(n ?? 0)).toLocaleString("en-US");

interface MenuItem { label: string; onClick: () => void; danger?: boolean }

// Three-dot row action menu. Positioned with fixed coordinates so it is not
// clipped by the table's horizontal-scroll container.
function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  function toggle() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // Estimate menu height and flip upward if there isn't room below.
      const est = Math.max(1, items.length) * 34 + 12;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const top = spaceBelow >= est ? r.bottom + 4 : Math.max(8, r.top - est - 4);
      setPos({ top, left: Math.max(8, r.right - 208) });
    }
    setOpen((o) => !o);
  }
  return (
    <>
      <button ref={btnRef} onClick={toggle} aria-label="Actions" className="rounded px-1.5 text-lg leading-none text-slate-500 hover:bg-slate-100">⋮</button>
      {open && pos && (
        <div ref={menuRef} className="fixed z-50 w-52 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg" style={{ top: pos.top, left: pos.left, maxHeight: "calc(100vh - 16px)" }}>
          {items.length === 0 && <div className="px-3 py-1.5 text-sm text-slate-400">No actions available</div>}
          {items.map((it, i) => (
            <button key={i} onClick={() => { setOpen(false); it.onClick(); }}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${it.danger ? "text-red-600" : "text-slate-700"}`}>{it.label}</button>
          ))}
        </div>
      )}
    </>
  );
}

// Add days to an ISO date (YYYY-MM-DD) using UTC arithmetic so the result never
// shifts across a day boundary in the viewer's local timezone (e.g. UTC+3).
function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

interface Reposition { id: string; from_city: string | null; to_city: string | null; distance_km: number | null; driver_name: string; route: string; trip_time: string | null }
export default function OperationsBoard({ date, today, trips, drivers, vehicles, vendors, agents, repositions = [], repositionedTripIds = [], canEdit, canAssign }: {
  date: string; today: string; trips: Trip[]; drivers: Driver[]; vehicles: Vehicle[]; vendors: Vendor[]; agents: Agent[];
  repositions?: Reposition[]; repositionedTripIds?: string[]; canEdit: boolean; canAssign: boolean;
}) {
  const repositioned = new Set(repositionedTripIds);
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [vendorFor, setVendorFor] = useState<string | null>(null);
  // Driver-details modal shown when outsourcing to a supplier vendor.
  const [vendorModal, setVendorModal] = useState<{ tripId: string; vendorId: string; vendorName: string; isDriver: boolean; fare: number | null; driverName: string; driverMobile: string; vendorCost: string } | null>(null);
  const [tripView, setTripView] = useState<Trip | null>(null);
  const [conflict, setConflict] = useState<{ tripId: string; driverId: string; driverName: string; reason: string } | null>(null);
  const [forceReason, setForceReason] = useState("");
  // Cash-received prompt shown when completing a direct cash customer's trip.
  const [cashModal, setCashModal] = useState<{ tripId: string; fare: number | null; collect: number | null; haji: string | null; edit: boolean } | null>(null);
  const [cashChoice, setCashChoice] = useState<"yes" | "no" | "other">("yes");
  const [cashOther, setCashOther] = useState("");

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
  const [showAgent, setShowAgent] = useState(false);
  const now = new Date();

  // The Agent column is hidden by default; it appears when the user filters by
  // Agent or explicitly toggles it on. Keeps the dispatch view clean.
  const agentColumn = showAgent || fAgent.length > 0;

  const tomorrow = useMemo(() => addDays(today, 1), [today]);

  // ---- Derived helpers -----------------------------------------------------
  const isDelayed = (t: Trip) => !!t.sched_s && new Date(t.sched_s) < now && ["pending", "assigned"].includes(t.status);
  // A trip is only "outsourced" once a vendor is actually attached. `outsource_required`
  // means it still NEEDS handling, so it stays in the Pending / Unassigned queue.
  const isOutsourced = (t: Trip) => t.is_outsourced || !!t.vendor_id || t.status === "outsourced";
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

  // Vehicle upgrade ranks — a driver may only serve a trip whose requested vehicle is
  // the same or LOWER category (downgrade). A Staria driver can do Camry/Starex, not
  // Hiace/GMC/Bus. Drivers whose vehicle is too small are hidden from the assign list.
  // Proposed (unconfirmed) assignments awaiting the dispatcher's confirm before agents
  // and drivers can see the driver details.
  const unconfirmedCount = useMemo(() => trips.filter((t) =>
    (t.driver_id || t.vendor_id) && ["assigned", "outsourced"].includes(t.status) && t.assignment_confirmed === false).length, [trips]);

  const rankOf = useMemo(() => { const m = new Map<string, number>(); vehicles.forEach((v) => m.set(v.id, v.upgrade_rank ?? 0)); return m; }, [vehicles]);
  const eligibleDrivers = (t: Trip) => {
    const reqId = t.requested_vehicle_id ?? t.vehicle_id;
    const reqRank = reqId ? (rankOf.get(reqId) ?? 0) : 0;
    return drivers.filter((d) => d.status === "active" && (!d.vehicle_id || (rankOf.get(d.vehicle_id) ?? 0) >= reqRank));
  };
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
  // Navigate by changing the ?date= query. router.refresh() forces the server
  // component to refetch so trips/KPIs update immediately for the new day.
  function go(d: string) { router.push(`/transport/operations?date=${d}`); router.refresh(); }
  function shift(days: number) { go(addDays(date, days)); }

  async function call(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    router.refresh();
    return true;
  }
  // The cash-received prompt is driven purely by the booking's payment method:
  // only Cash bookings collect cash at completion. No Cash / Card / Bank Transfer
  // (any agent or customer on credit) complete without the prompt.
  const isCashCustomer = (t: Trip) => {
    if (t.payment_method) return t.payment_method === "cash";
    // Unset (legacy): only a direct booking or the walk-in CASH CUSTOMER collects cash.
    return !t.agent_id || (t.agent_name ?? "").trim().toUpperCase() === "CASH CUSTOMER";
  };
  // Completing a trip: prompt for cash only for direct cash customers.
  function completeTrip(t: Trip) {
    if (isCashCustomer(t)) {
      setCashChoice("yes"); setCashOther("");
      setCashModal({ tripId: t.id, fare: t.sell_rate, collect: t.collect_amount ?? null, haji: t.passenger_name, edit: false });
    } else {
      if (!confirm(`Mark this trip as Completed?\n\n${t.passenger_name ?? "Trip"} — ${t.route_display ?? ""}`)) return;
      call("transport_complete_trip", { p_trip: t.id, p_cash: null });
    }
  }
  // Undo an accidental completion: send the trip back to an active state. Fully
  // reversible — no invoice/lock is created on completion.
  function reopenTrip(t: Trip) {
    if (!confirm("Reopen this completed trip? It will move back to an active state.")) return;
    const back = t.driver_id || t.vendor_id || t.is_outsourced ? "picked_up" : "pending";
    call("transport_set_trip_status", { p_trip: t.id, p_status: back });
  }
  // Edit cash received later (e.g. cash customer pays the next day) — prefilled.
  function editCash(t: Trip) {
    const c = t.cash_received;
    // Default "collect" amount = the agent-set collect_amount when present, else the fare.
    const expect = t.collect_amount ?? t.sell_rate;
    if (c == null) { setCashChoice("no"); setCashOther(""); }
    else if (expect != null && Number(c) === Number(expect)) { setCashChoice("yes"); setCashOther(""); }
    else { setCashChoice("other"); setCashOther(String(c)); }
    setCashModal({ tripId: t.id, fare: t.sell_rate, collect: t.collect_amount ?? null, haji: t.passenger_name, edit: true });
  }
  async function submitCash() {
    if (!cashModal) return;
    const cash = cashChoice === "yes" ? (cashModal.collect ?? cashModal.fare)
      : cashChoice === "other" ? (parseFloat(cashOther) || null)
      : null;
    const fn = cashModal.edit ? "transport_set_cash_received" : "transport_complete_trip";
    const ok = await call(fn, { p_trip: cashModal.tripId, p_cash: cash });
    if (ok) setCashModal(null);
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

  // Outsource a trip to a vendor. Vendor-drivers are the driver themselves, so
  // assign immediately; supplier vendors need the specific driver's name/number.
  function pickVendor(t: Trip, vendorId: string) {
    const ven = vendors.find((v) => v.id === vendorId);
    setVendorFor(null);
    // Always open the modal so the vendor cost can be entered; supplier vendors
    // also capture the driver's name/number (vendor-drivers are auto-filled).
    setVendorModal({
      tripId: t.id, vendorId, vendorName: ven?.name ?? "vendor",
      isDriver: ven?.vendor_type === "vendor_driver",
      fare: t.sell_rate, driverName: "", driverMobile: "", vendorCost: t.vendor_cost != null ? String(t.vendor_cost) : "",
    });
  }
  async function submitVendor() {
    if (!vendorModal) return;
    const ok = await call("transport_assign_vendor", {
      p_trip: vendorModal.tripId, p_vendor: vendorModal.vendorId,
      p_driver_name: vendorModal.driverName.trim() || null, p_driver_mobile: vendorModal.driverMobile.trim() || null,
      p_vendor_cost: vendorModal.vendorCost.trim() === "" ? null : Number(vendorModal.vendorCost),
    });
    if (ok) setVendorModal(null);
  }

  // Copy a driver's details as a shareable text block (WhatsApp etc.). Falls
  // back to the outsourced driver's details when the trip is with a vendor.
  function copyDriver(t: Trip) {
    const text = [
      `Haji Name : ${t.passenger_name ?? "—"}`,
      `Route : ${t.route_display}`,
      `Trip Date : ${copyDate(t.trip_date)}`,
      ``,
      `*Driver Details*`,
      `Name : ${t.driver_name ?? t.outsource_driver_name ?? "—"}`,
      `Number : ${t.driver_mobile ?? t.outsource_driver_mobile ?? "—"}`,
      `Vehicle : ${t.vehicle_name ?? t.requested_vehicle_name ?? t.vehicle_type ?? "—"}`,
      ...(t.is_upgraded ? [`*Upgraded* : ${t.requested_vehicle_name ?? "—"} → ${t.vehicle_name ?? "—"}`] : []),
      `Car Reg No : ${t.driver_reg ?? "—"}`,
      ...(t.vendor_name ? [`Vendor : ${t.vendor_name}`] : []),
    ].join("\n");
    navigator.clipboard?.writeText(text).then(() => setErr("Driver details copied to clipboard."),
      () => setErr("Could not copy — clipboard blocked."));
  }

  // Compact date for copied messages, e.g. "08 Aug-26" (TZ-safe, no Date parsing).
  function copyDate(s: string | null): string {
    if (!s) return "—";
    const [y, m, d] = s.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (!y || !m || !d) return s;
    return `${String(d).padStart(2, "0")} ${months[m - 1]}-${String(y).slice(-2)}`;
  }

  // Format a yyyy-mm-dd date as e.g. "3rd Aug 2026" (no Date parsing → TZ-safe).
  function prettyDate(s: string | null): string {
    if (!s) return "—";
    const [y, m, d] = s.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (!y || !m || !d) return s;
    const ord = d % 10 === 1 && d % 100 !== 11 ? "st" : d % 10 === 2 && d % 100 !== 12 ? "nd" : d % 10 === 3 && d % 100 !== 13 ? "rd" : "th";
    return `${d}${ord} ${months[m - 1]} ${y}`;
  }

  // Copy trip details for sharing (WhatsApp-formatted, *bold* payment), split
  // into Passenger / Trip / Payment. Cash bookings show the method + amount to
  // collect; every non-cash booking (agent no-cash, card, bank transfer) shows NO CASH.
  function copyTrip(t: Trip) {
    const payLabel: Record<string, string> = { cash: "Cash", card: "Card", bank_transfer: "Bank Transfer" };
    const method = payLabel[t.payment_method ?? "cash"] ?? "Cash";

    const passenger = [
      `*Passenger Details*`,
      `Name : ${t.passenger_name ?? "—"}`,
      t.mobile ? `Mobile : ${t.mobile}` : null,
      t.whatsapp ? `WhatsApp : ${t.whatsapp}` : null,
      (!t.mobile && !t.whatsapp) ? `Contact : —` : null,
      `No. of Passengers : ${t.pax ?? "—"}`,
    ].filter(Boolean);

    const trip = [
      `*Trip Details*`,
      `Date : ${prettyDate(t.trip_date)}`,
      `Time : ${fmtTime12(t.trip_time) || "—"}`,
      `Route : ${t.route_display}`,
      t.flight_no ? `Flight : ${t.flight_no}` : null,
      `Vehicle : ${t.requested_vehicle_name ?? t.vehicle_name ?? "—"}`,
      `Pickup : ${t.pickup_location ?? "—"}`,
      `Drop-off : ${t.drop_location ?? "—"}`,
    ].filter(Boolean);

    const payment = [
      `*Payment*`,
      isCashCustomer(t) ? `Method : *${method}*\nAmount : ${sar(t.sell_rate)} SAR` : `*NO CASH*`,
    ];

    const text = [passenger.join("\n"), trip.join("\n"), payment.join("\n")].join("\n\n");
    navigator.clipboard?.writeText(text).then(() => setErr("Trip details copied to clipboard."),
      () => setErr("Could not copy — clipboard blocked."));
  }

  // Build the authorized action list for a row's three-dot menu.
  function rowActions(t: Trip): MenuItem[] {
    const open = t.status !== "cancelled" && t.status !== "completed";
    const items: MenuItem[] = [{ label: "View Trip Details", onClick: () => setTripView(t) }];
    if (canEdit) items.push({ label: "Edit Booking", onClick: () => router.push(`/transport/bookings/${t.booking_id}`) });
    items.push({ label: "Copy Trip Details", onClick: () => copyTrip(t) });
    if (t.driver_id || t.outsource_driver_name) items.push({ label: "Copy Driver Details", onClick: () => copyDriver(t) });
    if (canAssign && open) items.push({ label: t.driver_id ? "Reassign Driver" : "Assign Driver", onClick: () => { setVendorFor(null); setAssignFor(t.id); } });
    if (canAssign && open && vendors.length > 0) items.push({ label: t.vendor_id ? "Change Vendor" : "Assign Vendor", onClick: () => { setAssignFor(null); setVendorFor(t.id); } });
    if (canAssign && t.driver_id && open) items.push({ label: "Unassign Driver", onClick: () => call("transport_unassign_trip", { p_trip: t.id }) });
    if (canAssign && open && repositioned.has(t.id)) items.push({ label: "Reset Repositioning", onClick: () => { if (confirm("Reset this repositioning? The trip will be unassigned and re-opened for planning.")) call("transport_reset_reposition", { p_trip: t.id }); } });
    if (canAssign && t.vendor_id && open) items.push({ label: "Unassign Vendor", onClick: () => call("transport_unassign_trip", { p_trip: t.id }) });
    if (canAssign && NEXT_TRIP[t.status]) items.push({ label: `Mark ${NEXT_LABEL[NEXT_TRIP[t.status]]}`, onClick: () => NEXT_TRIP[t.status] === "completed" ? completeTrip(t) : call("transport_set_trip_status", { p_trip: t.id, p_status: NEXT_TRIP[t.status] }) });
    if (canAssign && ["assigned", "on_route", "outsourced"].includes(t.status)) items.push({ label: "Mark Completed", onClick: () => completeTrip(t) });
    if (canAssign && isCashCustomer(t)) items.push({ label: "Edit Cash Received", onClick: () => editCash(t) });
    if (canAssign && open) items.push({ label: "Cancel Trip", danger: true, onClick: () => { if (confirm("Cancel this trip?")) call("transport_set_trip_status", { p_trip: t.id, p_status: "cancelled" }); } });
    // A cancelled trip may need to be restored (cancelled by mistake / actually ran):
    // let dispatchers reopen it or mark it completed directly.
    if (canAssign && t.status === "cancelled") {
      items.push({ label: "Reopen Trip", onClick: () => call("transport_set_trip_status", { p_trip: t.id, p_status: t.driver_id ? "assigned" : "pending" }) });
      items.push({ label: "Mark Completed", onClick: () => completeTrip(t) });
    }
    // A completed trip can be reopened (completed by mistake / needs correction).
    if (canAssign && t.status === "completed") {
      items.push({ label: "Undo Completion", onClick: () => reopenTrip(t) });
    }
    return items;
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
        <Link href="/transport/drivers/dashboard" className="btn-outline ml-auto text-sm">📡 Driver Dashboard</Link>
        <Link href={`/transport/operations/dispatch?date=${date}`} className="btn-outline text-sm">📄 Driver Sheets</Link>
        <button onClick={async () => { await call("transport_auto_assign", { p_date: date }); }} disabled={busy} className="btn text-sm">{busy ? "Assigning…" : "⚙ Auto Assign Drivers"}</button>
        {canAssign && unconfirmedCount > 0 && (
          <button
            onClick={async () => {
              if (!confirm(`Confirm ${unconfirmedCount} proposed assignment${unconfirmedCount === 1 ? "" : "s"} for ${date}? Agents and drivers will then see the assigned driver details.`)) return;
              await call("transport_confirm_assignments", { p_date: date });
            }}
            disabled={busy} className="btn bg-green-600 text-sm hover:bg-green-700">✓ Confirm Assignments ({unconfirmedCount})</button>
        )}
        {canAssign && <button
          onClick={async () => {
            if (!confirm(`Reset ALL assignments for ${date}? Every assigned/outsourced trip that day returns to Pending (drivers & vendors cleared). Completed and cancelled trips are untouched.`)) return;
            const { data, error } = await supabase.rpc("transport_reset_assignments", { p_date: date });
            if (error) { setErr(error.message); return; }
            setErr(`Reset ${data ?? 0} trip(s) to Pending.`); router.refresh();
          }}
          disabled={busy} className="btn-outline text-sm text-red-600">↺ Reset Assignments</button>}
      </div>
      {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* Long-reposition approvals raised by auto-assign (>100km empty move) */}
      {canAssign && repositions.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="mb-1 text-sm font-semibold text-amber-800">↪ Reposition approval needed ({repositions.length})</div>
          <p className="mb-2 text-xs text-amber-700">These trips can only be covered in-house by moving a driver more than 100km empty. Approve to assign (and log the move) or reject to outsource instead.</p>
          <ul className="space-y-1">
            {repositions.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded bg-white/70 px-2 py-1 text-sm">
                <span className="font-medium text-slate-700">{r.driver_name}</span>
                <span className="text-slate-500">{r.from_city ?? "?"} → {r.to_city ?? "?"} · {r.distance_km != null ? `${Math.round(Number(r.distance_km))}km` : "?"}</span>
                <span className="text-slate-400">for {r.route}{r.trip_time ? ` @ ${fmtTime12(r.trip_time)}` : ""}</span>
                <span className="ml-auto flex gap-2">
                  <button disabled={busy} onClick={() => call("transport_approve_reposition", { p_id: r.id })} className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700">Approve</button>
                  <button disabled={busy} onClick={() => call("transport_reject_reposition", { p_id: r.id })} className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Reject</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
        <label className="ml-auto flex items-center gap-1 text-sm text-slate-500">
          <input type="checkbox" checked={showAgent} onChange={(e) => setShowAgent(e.target.checked)} /> Show agent
        </label>
        <span className="text-sm text-slate-500">{filtered.length} of {trips.length} trip(s)</span>
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
                <th className="px-3 py-2">Haji Name</th>
                {agentColumn && <th className="px-3 py-2">Agent</th>}
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Driver / Managed By</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const delayed = isDelayed(t);
                return (
                  <tr key={t.id} className={`border-t border-slate-100 align-top hover:bg-slate-50 ${delayed ? "bg-rose-50/40" : ""}`}>
                    <td className="px-3 py-2 font-semibold text-slate-700">{fmtTime12(t.trip_time) || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-700">{t.passenger_name ?? <span className="text-slate-400">—</span>}</div>
                      {t.pax != null && <div className="text-[11px] text-slate-400">{t.pax} pax</div>}
                    </td>
                    {agentColumn && <td className="px-3 py-2">{t.agent_name ?? "—"}</td>}
                    <td className="px-3 py-2">{t.route_display}
                      {t.hajj_terminal && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Hajj Terminal</span>}
                      {t.booking_type && <div className="text-[11px] text-slate-400">{t.booking_type.replace(/_/g, " ")}</div>}</td>
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
                      {t.outsource_driver_name && !t.driver_name && (
                        <div className="text-[11px] text-slate-500">🧑‍✈️ {t.outsource_driver_name}{t.outsource_driver_mobile ? ` · ${t.outsource_driver_mobile}` : ""}</div>
                      )}
                      {isOutsourced(t) && (t.sell_rate != null || t.vendor_cost != null) && (
                        <div className="mt-0.5 text-[11px] font-medium text-slate-600">
                          {t.sell_rate != null && <>Trip fare: {sar(t.sell_rate)} SAR</>}
                          {t.vendor_cost != null && <span className="text-purple-700"> · Vendor: {sar(t.vendor_cost)} SAR</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_META[t.status]?.chip ?? "bg-slate-200 text-slate-600"}`}>{STATUS_META[t.status]?.label ?? t.status.replace(/_/g, " ")}</span>
                      {delayed && <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">delayed</span>}
                      {t.needs_tafweej && (
                        <label className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${t.tafweej_created ? "text-green-700" : "text-orange-600"}`}>
                          <input type="checkbox" disabled={busy || !canAssign} checked={!!t.tafweej_created}
                            onChange={(e) => call("transport_set_tafweej", { p_trip: t.id, p_val: e.target.checked })} />
                          Tafweej Created
                        </label>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {assignFor === t.id ? (
                          <>
                            <select className="input max-w-[11rem] text-sm" defaultValue=""
                              onChange={(e) => { if (e.target.value) { const d = drivers.find((x) => x.id === e.target.value); tryAssign(t.id, e.target.value, d?.name ?? "driver"); } }}>
                              <option value="">Choose driver…</option>
                              {eligibleDrivers(t).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            <button onClick={() => setAssignFor(null)} className="text-xs text-slate-400 hover:underline">✕</button>
                          </>
                        ) : vendorFor === t.id ? (
                          <>
                            <select className="input max-w-[12rem] text-sm" value={t.vendor_id ?? ""}
                              onChange={(e) => { if (e.target.value) pickVendor(t, e.target.value); }}>
                              <option value="">Choose vendor…</option>
                              {(() => {
                                const veh = t.vehicle_id ?? t.requested_vehicle_id;
                                const rankOf = (id?: string | null) => (id ? vehicles.find((x) => x.id === id)?.upgrade_rank ?? 0 : 0);
                                const need = rankOf(veh);
                                // A vendor can cover this trip if they operate a vehicle whose upgrade
                                // rank is at least the booked one's — a higher-rank vehicle is a valid
                                // upgrade, a lower-rank one is a downgrade. Mirrors the auto-assign
                                // ladder (Camry=1, Starex=2, Staria=3…). Vendors with no vehicles set,
                                // or trips with no vehicle, are unconstrained. Exact-vehicle vendors first.
                                const canCover = (v: Vendor) => !v.vehicle_ids || v.vehicle_ids.length === 0 || !need
                                  || v.vehicle_ids.some((id) => rankOf(id) >= need);
                                const exact = (v: Vendor) => !!veh && !!v.vehicle_ids && v.vehicle_ids.includes(veh);
                                return vendors.filter(canCover).sort((a, b) => Number(exact(b)) - Number(exact(a)))
                                  .map((v) => <option key={v.id} value={v.id}>{v.name}{v.vendor_type === "vendor_driver" ? " (driver)" : ""}</option>);
                              })()}
                            </select>
                            <button onClick={() => setVendorFor(null)} className="text-xs text-slate-400 hover:underline">✕</button>
                          </>
                        ) : (
                          <RowMenu items={rowActions(t)} />
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

      {tripView && (() => {
        const t = tripView;
        const payLabel: Record<string, string> = { cash: "Cash", card: "Card", bank_transfer: "Bank Transfer" };
        const rows: [string, any][] = [
          ["Passenger", t.passenger_name ?? "—"],
          ["Mobile", t.mobile ?? "—"],
          ["WhatsApp", t.whatsapp ?? "—"],
          ["No. of Passengers", t.pax ?? "—"],
          ["Date", t.trip_date ?? "—"],
          ["Time", fmtTime12(t.trip_time) || "—"],
          ["Route", t.route_display],
          ...(t.flight_no ? [["Flight", t.flight_no] as [string, any]] : []),
          ["Vehicle (booked)", t.requested_vehicle_name ?? t.vehicle_name ?? "—"],
          ["Pickup", t.pickup_location ?? "—"],
          ["Drop-off", t.drop_location ?? "—"],
          ["Driver / Vendor", t.driver_name ?? (t.vendor_name ? `${t.vendor_name}${t.outsource_driver_name ? ` · ${t.outsource_driver_name}` : ""}` : "—")],
          ["Status", STATUS_META[t.status]?.label ?? t.status],
          ["Payment", isCashCustomer(t) ? `${payLabel[t.payment_method ?? "cash"] ?? "Cash"} — ${sar(t.sell_rate)} SAR` : "NO CASH"],
        ];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setTripView(null)}>
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-800">Trip Details</h3>
                <button onClick={() => setTripView(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {rows.map(([k, v], i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1.5 pr-3 text-slate-400">{k}</td>
                      <td className="py-1.5 font-medium text-slate-800">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => copyTrip(t)} className="btn-outline text-sm">📋 Copy</button>
                <button onClick={() => setTripView(null)} className="btn text-sm">Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {vendorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800">🏢 Outsource to {vendorModal.vendorName}</h3>
            {vendorModal.fare != null && <p className="mt-1 text-sm text-slate-500">Trip fare (our selling price): <b>{sar(vendorModal.fare)} SAR</b> — negotiate the vendor cost below.</p>}
            {vendorModal.isDriver ? (
              <p className="mt-1 text-sm text-slate-600">This vendor is the driver — their own name &amp; number are used.</p>
            ) : (
              <>
                <label className="label mt-3">Driver name</label>
                <input className="input" value={vendorModal.driverName} onChange={(e) => setVendorModal({ ...vendorModal, driverName: e.target.value })} placeholder="Driver full name" autoFocus />
                <label className="label mt-3">Driver mobile</label>
                <input className="input" value={vendorModal.driverMobile} onChange={(e) => setVendorModal({ ...vendorModal, driverMobile: e.target.value })} placeholder="+966 5x xxx xxxx" />
              </>
            )}
            <label className="label mt-3">Vendor cost (what we pay the vendor)</label>
            <input className="input" type="number" min="0" step="0.01" value={vendorModal.vendorCost} onChange={(e) => setVendorModal({ ...vendorModal, vendorCost: e.target.value })} placeholder="e.g. 230.00" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setVendorModal(null)} className="btn-outline text-sm">Cancel</button>
              <button onClick={submitVendor} disabled={busy} className="btn text-sm">{busy ? "Saving…" : "Assign Vendor"}</button>
            </div>
          </div>
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

      {cashModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800">{cashModal.edit ? "Edit Cash Received" : "Cash Received?"}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {cashModal.edit ? "Update cash for" : "Completing"} {cashModal.haji ?? "this trip"}{cashModal.fare != null ? ` · fare ${sar(cashModal.fare)} SAR` : ""}.
            </p>
            {cashModal.collect != null && cashModal.collect !== cashModal.fare && (
              <p className="mt-1 rounded-md bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800">Collect from passenger: {sar(cashModal.collect)} SAR</p>
            )}
            <div className="mt-4 flex gap-2">
              {([["yes", "Yes"], ["no", "No"], ["other", "Other"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setCashChoice(v)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${cashChoice === v ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{l}</button>
              ))}
            </div>
            {cashChoice === "other" && (
              <div className="mt-3">
                <label className="label">Amount received (SAR)</label>
                <input type="number" min="0" step="0.01" className="input" value={cashOther} autoFocus
                  onChange={(e) => setCashOther(e.target.value)} placeholder="0.00" />
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">
              {cashChoice === "yes" ? `${sar(cashModal.collect ?? cashModal.fare ?? 0)} SAR will be recorded as cash received.` : cashChoice === "no" ? "No cash will be recorded." : "The amount you enter will be recorded as cash received."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCashModal(null)} className="btn-outline text-sm">Cancel</button>
              <button onClick={submitCash} disabled={busy || (cashChoice === "other" && !cashOther)} className="btn text-sm">{cashModal.edit ? "Save" : "Complete Trip"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
