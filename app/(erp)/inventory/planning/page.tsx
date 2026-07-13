import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompanyFilter from "@/components/CompanyFilter";
import { money } from "@/lib/format";
import { Brn, Consumption, nightsBetween, fmtDay } from "@/lib/brn";
import { PendGroup, buildDemand, recommendBrns, DayDemand, BrnRecommendation } from "@/lib/planning";
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

interface CompanyPlan {
  id: string; name: string; groups: PendGroup[]; brns: Brn[];
  demand: DayDemand[]; recs: BrnRecommendation[];
  pilgrims: number; capacityGap: number; capacity: number;
}

function planFor(id: string, name: string, groups: PendGroup[], brns: Brn[], consByBrn: Record<string, Consumption[]>): CompanyPlan {
  let days: string[] = [];
  if (groups.length) {
    const min = groups.reduce((m, g) => (g.arrival_date < m ? g.arrival_date : m), groups[0].arrival_date);
    const max = groups.reduce((m, g) => (g.departure_date > m ? g.departure_date : m), groups[0].departure_date);
    days = nightsBetween(min, max);
  }
  const demand = buildDemand(days, groups, brns, consByBrn);
  return {
    id, name, groups, brns, demand, recs: recommendBrns(demand),
    pilgrims: groups.reduce((s, g) => s + g.pax, 0),
    capacityGap: demand.reduce((s, d) => s + d.shortage, 0),
    capacity: brns.reduce((s, b) => s + b.beds, 0),
  };
}

export default async function PlanningPage({ searchParams }: { searchParams: { company?: string } }) {
  const company = searchParams.company ?? "";
  const supabase = createClient();
  const [{ data: groups }, { data: brns }, { data: cons }, { data: companies }] = await Promise.all([
    supabase.from("umrah_groups")
      .select("id, group_no, pax, arrival_date, departure_date, group_company_id")
      .eq("brn_status", "pending").neq("visa_status", "issued"),
    supabase.from("brn_inventory").select("*"),
    supabase.from("brn_consumption").select("*"),
    supabase.from("group_companies").select("id, name").order("name"),
  ]);

  const allG = (groups ?? []) as (PendGroup & { group_company_id: string | null })[];
  const allB = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  const avgRate = (() => {
    const rated = allB.filter((b) => Number(b.rate_per_bed) > 0);
    return rated.length ? rated.reduce((s, b) => s + Number(b.rate_per_bed), 0) / rated.length : 0;
  })();
  const cost = (r: BrnRecommendation) => avgRate > 0 ? money(r.beds * r.nights * avgRate, "SAR") : "—";

  const comps = (companies ?? []) as { id: string; name: string }[];
  const plans: CompanyPlan[] = comps
    .map((c) => planFor(c.id, c.name, allG.filter((g) => g.group_company_id === c.id),
      allB.filter((b) => b.group_company_id === c.id), consByBrn))
    .filter((p) => p.groups.length > 0);

  // ---- Focused single-company view ----
  if (company) {
    const p = plans.find((x) => x.id === company)
      ?? planFor(company, comps.find((c) => c.id === company)?.name ?? "Company",
        allG.filter((g) => g.group_company_id === company), allB.filter((b) => b.group_company_id === company), consByBrn);
    const reqs = p.demand.map((d) => d.required);
    const avgDaily = reqs.length ? Math.round(reqs.reduce((s, x) => s + x, 0) / reqs.length) : 0;
    const peak = p.demand.reduce((m, d) => (d.required > (m?.required ?? -1) ? d : m), p.demand[0]);
    const daysShort = p.demand.filter((d) => d.shortage > 0).length;
    const dayTone = (d: DayDemand) => d.shortage > 0 ? "bg-red-500 text-white"
      : d.available - d.required < d.required * 0.2 ? "bg-yellow-200 text-yellow-900" : "bg-green-100 text-green-800";

    return (
      <div className="space-y-6">
        <PageHeader title={`BRN Purchase Planning — ${p.name}`} />
        <CompanyFilter companies={comps} value={company} />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Kpi label="Pending Groups" value={p.groups.length} />
          <Kpi label="Pending Pilgrims" value={p.pilgrims} />
          <Kpi label="Existing BRNs" value={p.brns.length} />
          <Kpi label="Existing Capacity" value={p.capacity} />
          <Kpi label="Projected Demand" value={p.demand.reduce((s, d) => s + d.required, 0)} tone="text-brand" />
          <Kpi label="Capacity Gap" value={p.capacityGap} tone={p.capacityGap > 0 ? "text-red-600" : "text-green-700"} />
          <Kpi label="Recommended BRNs" value={p.recs.length} tone={p.recs.length > 0 ? "text-orange-600" : "text-green-700"} />
        </div>

        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-700">🛒 Smart Purchase Recommendation</h2>
          {p.recs.length === 0 ? (
            <p className="text-sm text-green-700">✓ Existing inventory covers all pending demand for {p.name}.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {p.recs.map((r, i) => (
                <div key={i} className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                  <p className="font-semibold text-orange-800">New BRN {i + 1}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-800">{r.beds} beds</p>
                  <p className="text-sm text-slate-600">{fmtDay(r.from)} → {fmtDay(r.to)} · {r.nights} night(s)</p>
                  {avgRate > 0 && <p className="mt-1 text-xs text-slate-500">≈ {cost(r)}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-700">📈 Demand Trends</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><p className="text-xs text-slate-400">Avg daily demand</p><p className="text-lg font-bold">{avgDaily} beds</p></div>
            <div><p className="text-xs text-slate-400">Peak demand</p><p className="text-lg font-bold">{peak?.required ?? 0} on {peak?.date ? fmtDay(peak.date) : "—"}</p></div>
            <div><p className="text-xs text-slate-400">Days needing BRNs</p><p className="text-lg font-bold text-red-600">{daysShort}</p></div>
            <div><p className="text-xs text-slate-400">Forecast / day</p><p className="text-lg font-bold">{avgDaily} beds</p></div>
          </div>
        </div>

        <PurchaseSimulator demand={p.demand} />

        <div>
          <div className="mb-2 flex gap-2 text-xs">
            <span className="badge bg-green-100 text-green-700">🟢 Sufficient</span>
            <span className="badge bg-yellow-200 text-yellow-900">🟡 Low</span>
            <span className="badge bg-red-500 text-white">🔴 Purchase required</span>
          </div>
          <div className="card mb-3 flex flex-wrap gap-1">
            {p.demand.map((d) => (
              <div key={d.date} title={`${fmtDay(d.date)} — need ${d.required}, have ${d.available}, short ${d.shortage}`}
                className={`flex h-12 w-14 flex-col items-center justify-center rounded text-[10px] ${dayTone(d)}`}>
                <span className="font-semibold">{fmtDay(d.date)}</span>
                <span>{d.shortage > 0 ? `-${d.shortage}` : "ok"}</span>
              </div>
            ))}
            {p.demand.length === 0 && <p className="text-sm text-slate-400">No demand.</p>}
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Date</th><th className="th">Groups Arriving</th><th className="th">Groups Staying</th>
                  <th className="th">Required Beds</th><th className="th">Available Beds</th><th className="th">Shortage</th><th className="th">Purchase?</th>
                </tr>
              </thead>
              <tbody>
                {p.demand.map((d) => (
                  <tr key={d.date} className={`border-t border-slate-100 ${d.shortage > 0 ? "bg-red-50" : ""}`}>
                    <td className="td font-medium">{fmtDay(d.date)}</td>
                    <td className="td">{d.arrivals}</td>
                    <td className="td">{d.staying}</td>
                    <td className="td font-medium">{d.required}</td>
                    <td className="td">{d.available}</td>
                    <td className="td font-semibold text-red-600">{d.shortage || ""}</td>
                    <td className="td">{d.shortage > 0 ? <span className="badge bg-red-500 text-white">Yes</span> : <span className="badge bg-green-100 text-green-700">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ---- All-companies overview ----
  const totalGroups = plans.reduce((s, p) => s + p.groups.length, 0);
  const totalPilgrims = plans.reduce((s, p) => s + p.pilgrims, 0);
  const totalGap = plans.reduce((s, p) => s + p.capacityGap, 0);
  const totalRecs = plans.reduce((s, p) => s + p.recs.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="BRN Purchase Planning" />
      <CompanyFilter companies={comps} value={company} />
      <p className="text-sm text-slate-500">
        Every pending group is planned. Inventory is never shared across companies — each company gets its own procurement plan. Select a company above for the full dashboard, recommendations, calendar and simulator.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Companies With Demand" value={plans.length} />
        <Kpi label="Pending Groups" value={totalGroups} />
        <Kpi label="Pending Pilgrims" value={totalPilgrims} />
        <Kpi label="Total Capacity Gap" value={totalGap} tone={totalGap > 0 ? "text-red-600" : "text-green-700"} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Company</th><th className="th">Pending Groups</th><th className="th">Pilgrims</th>
              <th className="th">Existing Capacity</th><th className="th">Capacity Gap</th><th className="th">Recommended BRNs</th><th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className={`border-t border-slate-100 ${p.capacityGap > 0 ? "bg-red-50" : ""}`}>
                <td className="td font-medium">{p.name}</td>
                <td className="td">{p.groups.length}</td>
                <td className="td">{p.pilgrims}</td>
                <td className="td">{p.capacity}</td>
                <td className="td font-semibold text-red-600">{p.capacityGap || ""}</td>
                <td className="td">{p.recs.length}</td>
                <td className="td"><a href={`/inventory/planning?company=${p.id}`} className="text-brand text-sm hover:underline">Open plan →</a></td>
              </tr>
            ))}
            {plans.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No pending groups to plan for.</td></tr>}
          </tbody>
        </table>
      </div>

      {totalRecs > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-700">🛒 Consolidated Recommendations by Company</h2>
          <div className="space-y-4">
            {plans.filter((p) => p.recs.length > 0).map((p) => (
              <div key={p.id}>
                <p className="mb-2 font-medium text-slate-700">{p.name}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {p.recs.map((r, i) => (
                    <div key={i} className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                      <p className="font-semibold text-orange-800">New BRN {i + 1}</p>
                      <p className="mt-1 text-2xl font-bold text-slate-800">{r.beds} beds</p>
                      <p className="text-sm text-slate-600">{fmtDay(r.from)} → {fmtDay(r.to)} · {r.nights} night(s)</p>
                      {avgRate > 0 && <p className="mt-1 text-xs text-slate-500">≈ {cost(r)}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
