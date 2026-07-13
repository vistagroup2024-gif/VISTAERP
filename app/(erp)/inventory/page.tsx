import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { Brn, Consumption, totals, dailyForBrn } from "@/lib/brn";

export const dynamic = "force-dynamic";

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

export default async function InventoryDashboard() {
  const supabase = createClient();
  const [{ data: brns }, { data: cons }] = await Promise.all([
    supabase.from("brn_inventory").select("*").order("check_in"),
    supabase.from("brn_consumption").select("*"),
  ]);

  const B = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const t = totals(B, C);

  const hotels = new Set(B.map((b) => b.hotel_name)).size;

  // Overbooked BRNs (any night with negative availability)
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));
  const overbooked = B.filter((b) =>
    dailyForBrn(b, consByBrn[b.id] ?? []).some((d) => d.available < 0)
  );

  return (
    <div>
      <PageHeader title="BRN Inventory Dashboard" action={{ href: "/inventory/brn/new", label: "+ Add BRN" }} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Hotels" value={hotels} />
        <Kpi label="Total BRNs" value={B.length} />
        <Kpi label="Bed-Nights" value={t.capacityNights} />
        <Kpi label="Consumed" value={t.usedNights} tone="text-brand" />
        <Kpi label="Remaining" value={t.availableNights} tone="text-green-600" />
        <Kpi label="Occupancy" value={`${t.occupancyPct}%`} tone={t.occupancyPct > 90 ? "text-red-600" : "text-slate-800"} />
      </div>

      {overbooked.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠️ <b>{overbooked.length}</b> BRN(s) are overbooked: {overbooked.map((b) => b.brn).join(", ")}
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/inventory/brn" className="card hover:border-brand hover:shadow-sm">
          <p className="text-lg font-semibold">📋 BRN List</p>
          <p className="text-sm text-slate-500">All purchased inventory</p>
        </Link>
        <Link href="/inventory/calendar" className="card hover:border-brand hover:shadow-sm">
          <p className="text-lg font-semibold">📅 Daily Calendar</p>
          <p className="text-sm text-slate-500">Availability grid per BRN</p>
        </Link>
        <Link href="/inventory/consume" className="card hover:border-brand hover:shadow-sm">
          <p className="text-lg font-semibold">➖ Consume Inventory</p>
          <p className="text-sm text-slate-500">Assign beds to a package</p>
        </Link>
        <Link href="/inventory/history" className="card hover:border-brand hover:shadow-sm">
          <p className="text-lg font-semibold">🧾 Consumption History</p>
          <p className="text-sm text-slate-500">All bookings against BRNs</p>
        </Link>
      </div>
    </div>
  );
}
