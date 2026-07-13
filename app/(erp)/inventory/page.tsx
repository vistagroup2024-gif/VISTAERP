import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { money } from "@/lib/format";
import { Brn, Consumption, dailyForBrn, usedOnNight } from "@/lib/brn";

export const dynamic = "force-dynamic";

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

// Available beds today across BRNs of a given city
function availableTodayForCity(B: Brn[], consByBrn: Record<string, Consumption[]>, city: string, today: string) {
  let cap = 0, used = 0;
  for (const b of B) {
    if (b.city === city && b.check_in <= today && b.check_out > today) {
      cap += b.beds;
      used += usedOnNight(today, consByBrn[b.id] ?? []);
    }
  }
  return cap - used;
}

export default async function InventoryDashboard() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [{ data: brns }, { data: cons }, { data: bills }] = await Promise.all([
    supabase.from("brn_inventory").select("*"),
    supabase.from("brn_consumption").select("*"),
    supabase.from("bills").select("total, amount_paid, status, currency"),
  ]);

  const B = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  let capacityNights = 0, usedNights = 0;
  const overbooked: string[] = [];
  for (const b of B) {
    const daily = dailyForBrn(b, consByBrn[b.id] ?? []);
    capacityNights += daily.reduce((s, d) => s + d.capacity, 0);
    usedNights += daily.reduce((s, d) => s + d.used, 0);
    if (daily.some((d) => d.available < 0)) overbooked.push(b.brn);
  }
  const totalBedsPurchased = B.reduce((s, b) => s + b.beds, 0);
  const totalBedsConsumed = C.reduce((s, c) => s + c.beds, 0); // active reservations (bed count)
  const activeAgreements = B.filter((b) => b.check_out > today).length;

  const makkahAvail = availableTodayForCity(B, consByBrn, "Makkah", today);
  const madinahAvail = availableTodayForCity(B, consByBrn, "Madinah", today);

  const checkInsToday = B.filter((b) => b.check_in === today).length;
  const checkOutsToday = B.filter((b) => b.check_out === today).length;
  const expiringSoon = B.filter((b) => b.check_out > today && b.check_out <= soon).length;

  const supplierOutstanding = (bills ?? [])
    .filter((b: any) => b.status !== "paid" && b.status !== "void")
    .reduce((s: number, b: any) => s + (Number(b.total) - Number(b.amount_paid)), 0);

  const occupancyPct = capacityNights > 0 ? Math.round((usedNights / capacityNights) * 100) : 0;

  return (
    <div>
      <PageHeader title="BRN Inventory Dashboard" action={{ href: "/inventory/brn/new", label: "+ Add BRN" }} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Kpi label="Active Agreements" value={activeAgreements} />
        <Kpi label="Total Beds Purchased" value={totalBedsPurchased} />
        <Kpi label="Beds Reserved" value={totalBedsConsumed} tone="text-brand" />
        <Kpi label="Occupancy (bed-nights)" value={`${occupancyPct}%`} tone={occupancyPct > 90 ? "text-red-600" : "text-slate-800"} />
        <Kpi label="Makkah Available (today)" value={makkahAvail} tone="text-green-600" />
        <Kpi label="Madinah Available (today)" value={madinahAvail} tone="text-green-600" />
        <Kpi label="Today's Check-ins" value={checkInsToday} />
        <Kpi label="Today's Check-outs" value={checkOutsToday} />
        <Kpi label="Agreements Expiring ≤7d" value={expiringSoon} tone={expiringSoon > 0 ? "text-orange-600" : "text-slate-800"} />
        <Kpi label="Supplier Outstanding" value={money(supplierOutstanding, "SAR")} tone="text-red-600" />
        <Kpi label="Total BRNs" value={B.length} />
        <Kpi label="Bed-Nights Capacity" value={capacityNights} />
      </div>

      {overbooked.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠️ <b>{overbooked.length}</b> BRN(s) overbooked: {overbooked.join(", ")}
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/inventory/brn" className="card hover:border-brand hover:shadow-sm">
          <p className="text-lg font-semibold">📋 BRN List</p>
          <p className="text-sm text-slate-500">Filter & sort all inventory</p>
        </Link>
        <Link href="/inventory/calendar" className="card hover:border-brand hover:shadow-sm">
          <p className="text-lg font-semibold">📅 Daily Calendar</p>
          <p className="text-sm text-slate-500">City-wise availability</p>
        </Link>
        <Link href="/inventory/consume" className="card hover:border-brand hover:shadow-sm">
          <p className="text-lg font-semibold">➖ Consume Inventory</p>
          <p className="text-sm text-slate-500">Manual bed assignment</p>
        </Link>
        <Link href="/inventory/history" className="card hover:border-brand hover:shadow-sm">
          <p className="text-lg font-semibold">🧾 History</p>
          <p className="text-sm text-slate-500">All consumption records</p>
        </Link>
      </div>
    </div>
  );
}
