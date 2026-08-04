import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const CARDS = [
  { href: "/transport/vehicles", icon: "🚗", title: "Vehicles", desc: "Fleet master — categories, capacity, images." },
  { href: "/transport/routes", icon: "🛣", title: "Routes", desc: "Routes with driving time and the airport flag." },
  { href: "/transport/rates", icon: "💲", title: "Rate Master", desc: "Effective-dated agent & vendor rates with history." },
  { href: "/transport/packages", icon: "🧳", title: "Packages", desc: "Bundle multiple trips into a fixed-price package." },
  { href: "/transport/drivers", icon: "🧑‍✈️", title: "Drivers", desc: "Driver master, documents, shift timing." },
  { href: "/transport/drivers/dashboard", icon: "📡", title: "Driver Dashboard", desc: "Live driver status, location, current & next trips." },
];

export default async function TransportOverview() {
  const sb = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: todayBookings }, { data: todayTrips }, { data: pendingConf }, { data: upcomingAirport }] = await Promise.all([
    sb.from("transport_bookings").select("total_amount, status").eq("booking_date", today),
    sb.from("transport_trip_sched").select("status, driver_id, vehicle_id").eq("trip_date", today),
    sb.from("transport_bookings").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("transport_trip_sched").select("id", { count: "exact", head: true }).gte("trip_date", today).ilike("route_name", "%airport%"),
  ]);

  const tb = todayBookings ?? [];
  const tt = todayTrips ?? [];
  const kpi = {
    bookings: tb.length,
    revenue: tb.filter((b: any) => b.status !== "cancelled").reduce((s: number, b: any) => s + Number(b.total_amount || 0), 0),
    inProgress: tt.filter((t: any) => ["on_route", "picked_up"].includes(t.status)).length,
    driversWorking: new Set(tt.filter((t: any) => t.driver_id).map((t: any) => t.driver_id)).size,
    vehiclesRunning: new Set(tt.filter((t: any) => ["on_route", "picked_up"].includes(t.status) && t.vehicle_id).map((t: any) => t.vehicle_id)).size,
    pendingConf: (pendingConf as any) ?? 0,
    pendingAssign: tt.filter((t: any) => !t.driver_id && t.status !== "cancelled" && t.status !== "completed").length,
    airport: (upcomingAirport as any) ?? 0,
  };

  const KPIS = [
    ["Today’s Bookings", kpi.bookings], ["Today’s Revenue", `${kpi.revenue.toFixed(0)} SAR`],
    ["Trips In Progress", kpi.inProgress], ["Vehicles Running", kpi.vehiclesRunning],
    ["Drivers Working", kpi.driversWorking], ["Pending Confirmations", kpi.pendingConf],
    ["Pending Assignments", kpi.pendingAssign], ["Upcoming Airport Trips", kpi.airport],
  ] as const;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Transport Management">
        <Link href="/transport/operations" className="btn-outline">Operations</Link>
        <Link href="/transport/reports" className="btn-outline">Reports</Link>
        <Link href="/transport/bookings/new" className="btn">+ New Booking</Link>
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {KPIS.map(([label, value]) => (
          <div key={label} className="card text-center">
            <div className="text-2xl font-bold text-slate-800">{value}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/transport/operations" className="card flex items-start gap-3 transition hover:shadow-md">
          <span className="text-xl">🗓</span><span><span className="block font-semibold text-slate-800">Operations</span><span className="block text-sm text-slate-500">Daily timeline, auto driver assignment, live tracking, dispatch sheets.</span></span>
        </Link>
        <Link href="/transport/bookings" className="card flex items-start gap-3 transition hover:shadow-md">
          <span className="text-xl">📕</span><span><span className="block font-semibold text-slate-800">Bookings</span><span className="block text-sm text-slate-500">Single / multiple / package bookings with automatic pricing & vouchers.</span></span>
        </Link>
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Master Data</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="card flex items-start gap-3 transition hover:shadow-md">
            <span className="text-xl">{c.icon}</span>
            <span><span className="block font-semibold text-slate-800">{c.title}</span><span className="block text-sm text-slate-500">{c.desc}</span></span>
          </Link>
        ))}
      </div>
    </div>
  );
}
