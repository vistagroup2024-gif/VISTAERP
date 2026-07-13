import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { money } from "@/lib/format";
import { Brn, Consumption, nightsBetween, fmtDay } from "@/lib/brn";
import { PendGroup, buildDemand, recommendBrns, todayUTC, addDaysUTC } from "@/lib/planning";
import PurchaseSimulator from "./PurchaseSimulator";

export const dynamic = "force-dynamic";

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

const PERIODS = [
  { d: 7, label: "Next 7 Days" },
  { d: 15, label: "Next 15 Days" },
  { d: 30, label: "Next 30 Days" },
  { d: 60, label: "Next 60 Days" },
];

export default async function PlanningPage({ searchParams }: { searchParams: { period?: string; from?: string; to?: string } }) {
  const period = Number(searchParams.period ?? 30);
  const start = searchParams.from || todayUTC();
  const end = searchParams.to || addDaysUTC(start, period);
  const days = nightsBetween(start, end); // occupied nights in [start, end)

  const supabase = createClient();
  const [{ data: groups }, { data: brns }, { data: cons }] = await Promise.all([
    supabase.from("umrah_groups")
      .select("id, group_no, pax, arrival_date, departure_date")
      .eq("brn_status", "pending").neq("visa_status", "issued")
      .lt("arrival_date", end).gte("departure_date", start),
    supabase.from("brn_inventory").select("*"),
    supabase.from("brn_consumption").select("*"),
  ]);

  const G = (groups ?? []) as PendGroup[];
  const B = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  const demand = buildDemand(days, G, B, consByBrn);
  const recs = recommendBrns(demand);

  // ---- KPIs ----
  const pendingGroups = G.length;
  const pendingPilgrims = G.reduce((s, g) => s + g.pax, 0);
  const existingBrns = B.length;
  const existingCapacity = B.reduce((s, b) => s + b.beds, 0);
  const projectedDemand = demand.reduce((s, d) => s + d.required, 0);        // bed-nights
  const capacityGap = demand.reduce((s, d) => s + d.shortage, 0);            // bed-nights short
  const avgRate = (() => {
    const rated = B.filter((b) => Number(b.rate_per_bed) > 0);
    return rated.length ? rated.reduce((s, b) => s + Number(b.rate_per_bed), 0) / rated.length : 0;
  })();
  const estCost = avgRate > 0 ? recs.reduce((s, r) => s + r.beds * r.nights * avgRate, 0) : 0;

  // ---- Trends ----
  const reqs = demand.map((d) => d.required);
  const avgDaily = reqs.length ? Math.round(reqs.reduce((s, x) => s + x, 0) / reqs.length) : 0;
  const peak = demand.reduce((m, d) => (d.required > m.required ? d : m), demand[0] ?? { date: "", required: 0 } as any);
  const low = demand.reduce((m, d) => (d.required < m.required ? d : m), demand[0] ?? { date: "", required: 0 } as any);
  const daysShort = demand.filter((d) => d.shortage > 0).length;

  const dayTone = (d: { required: number; available: number; shortage: number }) =>
    d.shortage > 0 ? "bg-red-500 text-white"
      : d.available - d.required < d.required * 0.2 ? "bg-yellow-200 text-yellow-900"
      : "bg-green-100 text-green-800";

  return (
    <div className="space-y-6">
      <PageHeader title="BRN Purchase Planning" />

      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link key={p.d} href={`/inventory/planning?period=${p.d}`}
            className={`rounded-md px-4 py-2 text-sm font-medium ${period === p.d && !searchParams.from ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {p.label}
          </Link>
        ))}
        <span className="self-center text-xs text-slate-400">Planning {fmtDay(start)} → {fmtDay(end)}</span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <Kpi label="Pending Groups" value={pendingGroups} />
        <Kpi label="Pending Pilgrims" value={pendingPilgrims} />
        <Kpi label="Existing BRNs" value={existingBrns} />
        <Kpi label="Existing Capacity" value={existingCapacity} />
        <Kpi label="Projected Demand" value={projectedDemand} tone="text-brand" />
        <Kpi label="Capacity Gap" value={capacityGap} tone={capacityGap > 0 ? "text-red-600" : "text-green-700"} />
        <Kpi label="Recommended BRNs" value={recs.length} tone={recs.length > 0 ? "text-orange-600" : "text-green-700"} />
        <Kpi label="Est. Purchase Cost" value={avgRate > 0 ? money(estCost, "SAR") : "—"} />
      </div>

      {/* Recommendations */}
      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-700">🛒 Smart Purchase Recommendation</h2>
        {recs.length === 0 ? (
          <p className="text-sm text-green-700">✓ Existing inventory covers all pending demand in this period. No purchase required.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recs.map((r, i) => (
              <div key={i} className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                <p className="font-semibold text-orange-800">New BRN {i + 1}</p>
                <p className="mt-1 text-2xl font-bold text-slate-800">{r.beds} beds</p>
                <p className="text-sm text-slate-600">{fmtDay(r.from)} → {fmtDay(r.to)} · {r.nights} night(s)</p>
                {avgRate > 0 && <p className="mt-1 text-xs text-slate-500">≈ {money(r.beds * r.nights * avgRate, "SAR")} @ {money(avgRate, "SAR")}/bed-night</p>}
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">Each recommended BRN is sized to the peak demand of a continuous shortage period and is at least as large as the biggest group, so it can serve many groups from one agreement.</p>
      </div>

      {/* Trends */}
      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-700">📈 Demand Trends</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div><p className="text-xs text-slate-400">Avg daily demand</p><p className="text-lg font-bold">{avgDaily} beds</p></div>
          <div><p className="text-xs text-slate-400">Peak demand</p><p className="text-lg font-bold">{peak?.required ?? 0} on {peak?.date ? fmtDay(peak.date) : "—"}</p></div>
          <div><p className="text-xs text-slate-400">Lowest demand</p><p className="text-lg font-bold">{low?.required ?? 0} on {low?.date ? fmtDay(low.date) : "—"}</p></div>
          <div><p className="text-xs text-slate-400">Days needing BRNs</p><p className="text-lg font-bold text-red-600">{daysShort}</p></div>
          <div><p className="text-xs text-slate-400">Forecast / day (next 30)</p><p className="text-lg font-bold">{avgDaily} beds</p></div>
        </div>
      </div>

      {/* Purchase simulation */}
      <PurchaseSimulator demand={demand} />

      {/* Calendar-based demand planning */}
      <div>
        <div className="mb-2 flex gap-2 text-xs">
          <span className="badge bg-green-100 text-green-700">🟢 Sufficient</span>
          <span className="badge bg-yellow-200 text-yellow-900">🟡 Low</span>
          <span className="badge bg-red-500 text-white">🔴 Purchase required</span>
        </div>
        {/* Visual color grid */}
        <div className="card mb-3 flex flex-wrap gap-1">
          {demand.map((d) => (
            <div key={d.date} title={`${fmtDay(d.date)} — need ${d.required}, have ${d.available}, short ${d.shortage}`}
              className={`flex h-12 w-14 flex-col items-center justify-center rounded text-[10px] ${dayTone(d)}`}>
              <span className="font-semibold">{fmtDay(d.date)}</span>
              <span>{d.shortage > 0 ? `-${d.shortage}` : "ok"}</span>
            </div>
          ))}
          {demand.length === 0 && <p className="text-sm text-slate-400">No demand in this period.</p>}
        </div>
        {/* Detailed table */}
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Date</th>
                <th className="th">Groups Arriving</th>
                <th className="th">Groups Staying</th>
                <th className="th">Required Beds</th>
                <th className="th">Available Beds</th>
                <th className="th">Shortage</th>
                <th className="th">Purchase?</th>
              </tr>
            </thead>
            <tbody>
              {demand.map((d) => (
                <tr key={d.date} className={`border-t border-slate-100 ${d.shortage > 0 ? "bg-red-50" : ""}`}>
                  <td className="td font-medium">{fmtDay(d.date)}</td>
                  <td className="td">{d.arrivals}</td>
                  <td className="td">{d.staying}</td>
                  <td className="td font-medium">{d.required}</td>
                  <td className="td">{d.available}</td>
                  <td className="td font-semibold text-red-600">{d.shortage || ""}</td>
                  <td className="td">
                    {d.shortage > 0
                      ? <span className="badge bg-red-500 text-white">Yes</span>
                      : <span className="badge bg-green-100 text-green-700">No</span>}
                  </td>
                </tr>
              ))}
              {demand.length === 0 && (
                <tr><td className="td text-slate-400" colSpan={7}>No pending groups in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
