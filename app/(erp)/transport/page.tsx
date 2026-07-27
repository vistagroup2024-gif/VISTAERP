import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const CARDS = [
  { href: "/transport/vehicles", icon: "🚗", title: "Vehicles", desc: "Fleet master — categories, capacity, images." },
  { href: "/transport/routes", icon: "🛣", title: "Routes & Rates", desc: "Routes with driving time, rest rules and per-vehicle rates." },
  { href: "/transport/packages", icon: "🧳", title: "Packages", desc: "Bundle multiple trips into a fixed-price package." },
  { href: "/transport/drivers", icon: "🧑‍✈️", title: "Drivers", desc: "Driver master, documents, shift timing." },
];

async function count(sb: any, table: string, filter?: [string, any]) {
  let q = sb.from(table).select("id", { count: "exact", head: true });
  if (filter) q = q.eq(filter[0], filter[1]);
  const { count } = await q;
  return count ?? 0;
}

export default async function TransportOverview() {
  const sb = createClient();
  const [vehicles, routes, packages, drivers] = await Promise.all([
    count(sb, "transport_vehicles", ["is_active", true]),
    count(sb, "transport_routes", ["is_active", true]),
    count(sb, "transport_packages", ["is_active", true]),
    count(sb, "transport_drivers", ["status", "active"]),
  ]);
  const stats: Record<string, number> = { "/transport/vehicles": vehicles, "/transport/routes": routes, "/transport/packages": packages, "/transport/drivers": drivers };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Transport Management" />
      <p className="mb-6 text-sm text-slate-500">
        Manage all transportation services for Umrah pilgrims — from rate setup and packages to bookings,
        operations, driver scheduling and dispatch. Start by building the master data below.
      </p>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="card transition hover:shadow-md">
            <div className="text-2xl">{c.icon}</div>
            <div className="mt-2 text-2xl font-bold text-slate-800">{stats[c.href]}</div>
            <div className="text-sm font-medium text-slate-600">{c.title}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="card flex items-start gap-3 transition hover:shadow-md">
            <span className="text-xl">{c.icon}</span>
            <span>
              <span className="block font-semibold text-slate-800">{c.title}</span>
              <span className="block text-sm text-slate-500">{c.desc}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        <b>Coming next:</b> Bookings (single / multiple / package) with automatic pricing, the Operations
        dashboard &amp; daily timeline, the auto driver-scheduling engine, dispatch sheets, white-label PDF
        vouchers, and reports. The database and permissions for these are already in place.
      </div>
    </div>
  );
}
