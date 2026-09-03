import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import CompanyFilter from "@/components/CompanyFilter";
import { money } from "@/lib/format";
import { Brn, Consumption, nightsBetween, fmtDay } from "@/lib/brn";
import { combinedCityDemand, DayDemand, BrnRecommendation, DemandItem, planByCity, applyBoundaryTolerance, buildDemandFromItems, recommendBrns } from "@/lib/planning";
import PurchaseSimulator from "./PurchaseSimulator";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

// The three planning views, surfaced as tabs. Opening a tab re-renders the page
// for that mode (server component keyed off ?mode=).
type PlanMode = "city" | "pending" | "overall";
const MODES: { key: PlanMode; label: string; hint: string }[] = [
  { key: "city", label: "By City", hint: "Makkah / Madinah split — the exact city-specific BRNs to buy." },
  { key: "pending", label: "Pending Groups Only", hint: "Only groups still pending BRN purchase (package updates excluded)." },
  { key: "overall", label: "Overall (no city)", hint: "All demand pooled across cities — a single combined plan." },
];

type PlanScope = "all" | "pending";
function PlanningTabs({ mode, company, scope }: { mode: PlanMode; company: string; scope: PlanScope }) {
  const q = (m: PlanMode) => `/inventory/planning?mode=${m}${company ? `&company=${company}` : ""}`;
  const sub = (s: PlanScope) => `/inventory/planning?mode=overall&scope=${s}${company ? `&company=${company}` : ""}`;
  const active = MODES.find((m) => m.key === mode) ?? MODES[0];
  return (
    <div className="space-y-2">
      <div className="inline-flex flex-wrap rounded-lg border border-slate-200 p-0.5">
        {MODES.map((m) => (
          <a key={m.key} href={q(m.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === m.key ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            {m.label}
          </a>
        ))}
      </div>
      {mode === "overall" && (
        <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50/60 p-0.5">
          {([{ k: "all", label: "All" }, { k: "pending", label: "Pending Groups" }] as { k: PlanScope; label: string }[]).map((s) => (
            <a key={s.k} href={sub(s.k)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${scope === s.k ? "bg-brand text-white" : "text-slate-600 hover:bg-white"}`}>
              {s.label}
            </a>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500">
        {active.hint}
        {mode === "overall" && (scope === "pending"
          ? " Showing only groups still pending BRN purchase (package updates excluded)."
          : " Showing all pending groups plus package updates.")}
      </p>
    </div>
  );
}

export const dynamic = "force-dynamic";

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

interface CItem extends DemandItem { companyId: string | null }
// A city-tagged purchase recommendation. BRNs are physically bought per city
// (Makkah or Madinah), so every actionable recommendation carries its city.
type CityRec = BrnRecommendation & { city: "Makkah" | "Madinah" };
interface CompanyPlan {
  id: string; name: string; count: number; brns: Brn[];
  demand: DayDemand[]; recs: CityRec[];
  cityPlan: ReturnType<typeof planByCity>;
  overallDemand: DayDemand[]; overallRecs: BrnRecommendation[];
  pilgrims: number; capacityGap: number; capacity: number;
}

function planFor(id: string, name: string, items: CItem[], brns: Brn[], consByBrn: Record<string, Consumption[]>): CompanyPlan {
  const allNights = items.flatMap((it) => Array.from(it.nights));
  let days: string[] = [];
  if (allNights.length) {
    const min = allNights.reduce((m, n) => (n < m ? n : m), allNights[0]);
    const max = allNights.reduce((m, n) => (n > m ? n : m), allNights[0]);
    // days must span from min night to the morning after the last night
    const d = new Date(max + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
    days = nightsBetween(min, d.toISOString().slice(0, 10));
  }
  const cityPlan = planByCity(items, brns, consByBrn);
  // City-consistent daily curve: shortage matches the per-city recommendations
  // (a Makkah group can't be seated by pooling Madinah beds), so the daily table
  // never says "No purchase" on a night the recommendation engine flags.
  const demand = combinedCityDemand(days, items, brns, consByBrn, cityPlan);
  // Recommendations are the ACTIONABLE city-specific BRNs — Makkah + Madinah.
  // (The combined daily curve is a diagnostic only; you can't buy a BRN that
  // spans both cities, so recommending against combined demand was misleading.)
  const recs: CityRec[] = [
    ...cityPlan.makkah.recs.map((r) => ({ ...r, city: "Makkah" as const })),
    ...cityPlan.madinah.recs.map((r) => ({ ...r, city: "Madinah" as const })),
  ];
  // Overall (no-city) view: pool every BRN and every group's nights together and
  // recommend against the combined shortage — a single citywide-agnostic plan.
  const overallDemand = buildDemandFromItems(days, items, brns, consByBrn);
  const overallRecs = recommendBrns(overallDemand);
  return {
    id, name, count: items.length, brns, demand, recs, cityPlan, overallDemand, overallRecs,
    pilgrims: items.reduce((s, it) => s + it.pax, 0),
    capacityGap: demand.reduce((s, d) => s + d.shortage, 0),
    capacity: brns.reduce((s, b) => s + b.beds, 0),
  };
}

export default async function PlanningPage({ searchParams }: { searchParams: { company?: string; mode?: string; scope?: string } }) {
  await guardStaffPage("brn.planning");
  const company = searchParams.company ?? "";
  const mode: PlanMode = (["city", "pending", "overall"].includes(searchParams.mode ?? "") ? searchParams.mode : "city") as PlanMode;
  // Overall (no city) has a secondary scope: "all" (default, includes package
  // updates) or "pending" (only groups still pending BRN purchase).
  const scope: PlanScope = mode === "overall" && searchParams.scope === "pending" ? "pending" : "all";
  // "Pending groups only" plans just the pending-BRN groups; the other modes also
  // fold in groups whose package needs updating (their uncovered nights) — except
  // the Overall view narrowed to "Pending Groups".
  const includeUpdates = mode !== "pending" && !(mode === "overall" && scope === "pending");
  const supabase = createClient();
  const [{ data: pendGroups }, { data: updGroups }, { data: brns }, { data: cons }, { data: companies }] = await Promise.all([
    supabase.from("umrah_groups")
      .select("id, group_no, pax, arrival_date, departure_date, group_company_id, visa_type")
      .eq("brn_status", "pending").neq("visa_status", "issued"),
    supabase.from("umrah_groups")
      .select("id, pax, arrival_date, departure_date, group_company_id, visa_type")
      .eq("package_status", "update_required"),
    supabase.from("brn_inventory").select("*"),
    fetchAllRows<Consumption>((from, to) => supabase.from("brn_consumption").select("*").order("id").range(from, to)),
    supabase.from("group_companies").select("id, name").order("name"),
  ]);

  const allB = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  // Covered nights per pending-update group (to compute only the UNCOVERED demand)
  const updIds = (updGroups ?? []).map((g: any) => g.id);
  // Bounded by the id list, not by a row count — many groups with a few
  // allocations each still adds up past a thousand rows.
  const { data: updAllocs } = updIds.length
    ? await fetchAllRows<any>((from, to) => supabase.from("group_brn_allocation")
        .select("group_id, brn_consumption:consumption_id(check_in, check_out, brn_inventory:brn_id(city))")
        .in("group_id", updIds).order("id").range(from, to))
    : { data: [] as any[] };
  const coveredByGroup: Record<string, Set<string>> = {};
  // Groups whose EXISTING allocation already includes a Madinah BRN — their package
  // already has Madinah, so their uncovered nights are planned as Makkah only.
  const hasMadinahGroup = new Set<string>();
  (updAllocs ?? []).forEach((a: any) => {
    if (!a.brn_consumption) return;
    const set = (coveredByGroup[a.group_id] ||= new Set());
    nightsBetween(a.brn_consumption.check_in, a.brn_consumption.check_out).forEach((n) => set.add(n));
    if (a.brn_consumption.brn_inventory?.city === "Madinah") hasMadinahGroup.add(a.group_id);
  });

  // Long Stay groups never use hotel BRNs — exclude from purchase planning entirely.
  const notLongStay = (g: any) => (g.visa_type ?? "normal") !== "long_stay";
  // New groups: full stay demand. Pending package updates: only uncovered nights.
  const rawItems: CItem[] = [
    ...(pendGroups ?? []).filter(notLongStay).map((g: any) => ({
      companyId: g.group_company_id, id: g.id, pax: g.pax, arrival: g.arrival_date, departure: g.departure_date,
      nights: new Set(nightsBetween(g.arrival_date, g.departure_date)),
    })),
    ...(includeUpdates ? (updGroups ?? []) : []).filter(notLongStay).map((g: any) => {
      const cov = coveredByGroup[g.id] ?? new Set<string>();
      const need = nightsBetween(g.arrival_date, g.departure_date).filter((n) => !cov.has(n));
      return { companyId: g.group_company_id, id: g.id, pax: g.pax, arrival: g.arrival_date, departure: g.departure_date, nights: new Set(need), hasMadinah: hasMadinahGroup.has(g.id) };
    }).filter((it) => it.nights.size > 0),
  ];
  // Apply the first/last-night tolerance so isolated boundary nights are not
  // recommended for purchase (matches BRN allocation's nusuk_complete policy).
  const items = (applyBoundaryTolerance(rawItems) as CItem[]).filter((it) => it.nights.size > 0);

  const avgRate = (() => {
    const rated = allB.filter((b) => Number(b.rate_per_bed) > 0);
    return rated.length ? rated.reduce((s, b) => s + Number(b.rate_per_bed), 0) / rated.length : 0;
  })();
  const cost = (r: BrnRecommendation) => avgRate > 0 ? money(r.beds * r.nights * avgRate, "SAR") : "—";

  const comps = (companies ?? []) as { id: string; name: string }[];
  const plans: CompanyPlan[] = comps
    .map((c) => planFor(c.id, c.name, items.filter((i) => i.companyId === c.id),
      allB.filter((b) => b.group_company_id === c.id), consByBrn))
    .filter((p) => p.count > 0);

  // ---- Focused single-company view ----
  if (company) {
    const p = plans.find((x) => x.id === company)
      ?? planFor(company, comps.find((c) => c.id === company)?.name ?? "Company",
        items.filter((i) => i.companyId === company), allB.filter((b) => b.group_company_id === company), consByBrn);
    const viewDemand = mode === "overall" ? p.overallDemand : p.demand;
    const viewRecs: BrnRecommendation[] = mode === "overall" ? p.overallRecs : p.recs;
    const reqs = viewDemand.map((d) => d.required);
    const avgDaily = reqs.length ? Math.round(reqs.reduce((s, x) => s + x, 0) / reqs.length) : 0;
    const peak = viewDemand.reduce((m, d) => (d.required > (m?.required ?? -1) ? d : m), viewDemand[0]);
    const daysShort = viewDemand.filter((d) => d.shortage > 0).length;
    const dayTone = (d: DayDemand) => d.shortage > 0 ? "bg-red-500 text-white"
      : d.available - d.required < d.required * 0.2 ? "bg-yellow-200 text-yellow-900" : "bg-green-100 text-green-800";

    const cityPlan = p.cityPlan;
    const CityBlock = ({ title, data, note }: { title: string; data: { demand: DayDemand[]; recs: BrnRecommendation[] }; note?: string }) => {
      const required = data.demand.reduce((s, d) => s + d.required, 0);
      const existing = data.demand.reduce((s, d) => s + Math.min(d.required, d.available), 0);
      return (
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="font-semibold text-slate-700">{title}</p>
          {note && <p className="mb-2 text-xs text-slate-500">{note}</p>}
          <div className="mb-2 grid grid-cols-3 gap-2 text-sm">
            <div><span className="text-slate-400">Beds required</span><br /><b>{required}</b></div>
            <div><span className="text-slate-400">Existing inventory</span><br /><b>{existing}</b></div>
            <div><span className="text-slate-400">Recommended BRNs</span><br /><b className={data.recs.length ? "text-orange-600" : "text-green-700"}>{data.recs.length}</b></div>
          </div>
          {data.recs.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {data.recs.map((r, i) => (
                <li key={i} className="rounded bg-orange-50 px-2 py-1 text-orange-800">
                  <b>{r.beds} beds</b> · {fmtDay(r.from)} → {fmtDay(r.to)} ({r.nights}n){avgRate > 0 ? ` · ≈ ${cost(r)}` : ""}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-green-700">✓ Covered by existing inventory.</p>}
        </div>
      );
    };

    return (
      <div className="space-y-6">
        <PageHeader title={`BRN Purchase Planning — ${p.name}`} />
        <CompanyFilter companies={comps} value={company} />
        <PlanningTabs mode={mode} company={company} scope={scope} />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Kpi label={mode === "pending" ? "Pending Groups" : "Groups (new + updates)"} value={p.count} />
          <Kpi label="Pending Pilgrims" value={p.pilgrims} />
          <Kpi label="Existing BRNs" value={p.brns.length} />
          <Kpi label="Existing Capacity" value={p.capacity} />
          <Kpi label="Projected Demand" value={viewDemand.reduce((s, d) => s + d.required, 0)} tone="text-brand" />
          <Kpi label="Capacity Gap" value={viewDemand.reduce((s, d) => s + d.shortage, 0)} tone={daysShort > 0 ? "text-red-600" : "text-green-700"} />
          <Kpi label="Recommended BRNs" value={viewRecs.length} tone={viewRecs.length > 0 ? "text-orange-600" : "text-green-700"} />
        </div>

        <div className="card">
          <h2 className="mb-1 font-semibold text-slate-700">🛒 Smart Purchase Recommendation</h2>
          <p className="mb-3 text-xs text-slate-500">
            {mode === "overall"
              ? "Demand is pooled across both cities (no Makkah/Madinah split), so a group can be seated by any BRN. Each BRN still must seat a whole group on every night."
              : "Each BRN must seat a whole group on every night (a group of 10 needs one BRN with ≥10 free beds — it cannot be split across smaller BRNs). BRNs are city-specific, so these are the exact Makkah/Madinah BRNs to buy — matching “Planning by City” below."}
          </p>
          {viewRecs.length === 0 ? (
            <p className="text-sm text-green-700">✓ Existing inventory covers all {mode === "pending" ? "pending-group" : "pending"} demand for {p.name}.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {viewRecs.map((r, i) => {
                const city = (r as CityRec).city;
                return (
                  <div key={i} className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-orange-800">New BRN {i + 1}</p>
                      {city && <span className={`badge ${city === "Makkah" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"}`}>{city === "Makkah" ? "🕋 Makkah" : "🕌 Madinah"}</span>}
                    </div>
                    <p className="mt-1 text-2xl font-bold text-slate-800">{r.beds} beds</p>
                    <p className="text-sm text-slate-600">{fmtDay(r.from)} → {fmtDay(r.to)} · {r.nights} night(s)</p>
                    {avgRate > 0 && <p className="mt-1 text-xs text-slate-500">≈ {cost(r)}</p>}
                  </div>
                );
              })}
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

        {mode !== "overall" && (
          <div className="card">
            <h2 className="mb-3 font-semibold text-slate-700">🏙️ Planning by City</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <CityBlock title="🕋 Makkah" data={cityPlan.makkah} note="Makkah nights. Groups whose package already includes Madinah are planned as Makkah only." />
              <CityBlock title="🕌 Madinah" data={cityPlan.madinah}
                note={`One Madinah night for each group that lacks Madinah — placed on free Madinah inventory first, buying only when none is available. On ${cityPlan.madinah.assignments.length} date(s): ${cityPlan.madinah.assignments.map((a) => `${fmtDay(a.date)} (${a.beds} beds, ${a.groups} grp)`).join(", ") || "—"}.`} />
            </div>
          </div>
        )}

        <PurchaseSimulator demand={viewDemand} />

        <div>
          <div className="mb-2 flex gap-2 text-xs">
            <span className="badge bg-green-100 text-green-700">🟢 Sufficient</span>
            <span className="badge bg-yellow-200 text-yellow-900">🟡 Low</span>
            <span className="badge bg-red-500 text-white">🔴 Purchase required</span>
          </div>
          <div className="card mb-3 flex flex-wrap gap-1">
            {viewDemand.map((d) => (
              <div key={d.date} title={`${fmtDay(d.date)} — need ${d.required}, have ${d.available}, short ${d.shortage}`}
                className={`flex h-12 w-14 flex-col items-center justify-center rounded text-[10px] ${dayTone(d)}`}>
                <span className="font-semibold">{fmtDay(d.date)}</span>
                <span>{d.shortage > 0 ? `-${d.shortage}` : "ok"}</span>
              </div>
            ))}
            {viewDemand.length === 0 && <p className="text-sm text-slate-400">No demand.</p>}
          </div>
          <p className="mb-2 text-xs text-slate-500">
            “Available Beds” is total free beds that night. “Shortage” applies the one-BRN-per-group rule: a group counts as covered only if a single BRN can seat all its pax — so a night can still show a shortage even when total free beds ≥ required (e.g. 14 free beds split across small BRNs cannot seat a group of 10). It is also city-specific — a Makkah group can only use a Makkah BRN — so “Available Beds” (both cities) may exceed “Required” while a real shortage remains, matching the city recommendations above.
          </p>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Date</th><th className="th">Groups Arriving</th><th className="th">Groups Staying</th>
                  <th className="th">Required Beds</th><th className="th">Available Beds</th><th className="th">Shortage</th><th className="th">Purchase?</th>
                </tr>
              </thead>
              <tbody>
                {viewDemand.map((d) => (
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
  const recsOf = (p: CompanyPlan): BrnRecommendation[] => (mode === "overall" ? p.overallRecs : p.recs);
  const gapOf = (p: CompanyPlan) => (mode === "overall" ? p.overallDemand.reduce((s, d) => s + d.shortage, 0) : p.capacityGap);
  const totalGroups = plans.reduce((s, p) => s + p.count, 0);
  const totalPilgrims = plans.reduce((s, p) => s + p.pilgrims, 0);
  const totalGap = plans.reduce((s, p) => s + gapOf(p), 0);
  const totalRecs = plans.reduce((s, p) => s + recsOf(p).length, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="BRN Purchase Planning" />
      <CompanyFilter companies={comps} value={company} />
      <PlanningTabs mode={mode} company={company} scope={scope} />
      <p className="text-sm text-slate-500">
        {mode === "pending"
          ? "Only groups still pending BRN purchase are planned (package updates excluded). "
          : mode === "overall"
            ? "Demand is pooled across cities (no Makkah/Madinah split). "
            : "Every pending group is planned. "}
        Inventory is never shared across companies — each company gets its own procurement plan. Select a company above for the full dashboard, recommendations, calendar and simulator.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Companies With Demand" value={plans.length} />
        <Kpi label={mode === "pending" ? "Pending Groups" : "Groups"} value={totalGroups} />
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
              <tr key={p.id} className={`border-t border-slate-100 ${gapOf(p) > 0 ? "bg-red-50" : ""}`}>
                <td className="td font-medium">{p.name}</td>
                <td className="td">{p.count}</td>
                <td className="td">{p.pilgrims}</td>
                <td className="td">{p.capacity}</td>
                <td className="td font-semibold text-red-600">{gapOf(p) || ""}</td>
                <td className="td">{recsOf(p).length}</td>
                <td className="td"><a href={`/inventory/planning?mode=${mode}&company=${p.id}${mode === "overall" && scope === "pending" ? "&scope=pending" : ""}`} className="text-brand text-sm hover:underline">Open plan →</a></td>
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
            {plans.filter((p) => recsOf(p).length > 0).map((p) => (
              <div key={p.id}>
                <p className="mb-2 font-medium text-slate-700">{p.name}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {recsOf(p).map((r, i) => {
                    const city = (r as CityRec).city;
                    return (
                      <div key={i} className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-orange-800">New BRN {i + 1}</p>
                          {city && <span className={`badge ${city === "Makkah" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"}`}>{city === "Makkah" ? "🕋 Makkah" : "🕌 Madinah"}</span>}
                        </div>
                        <p className="mt-1 text-2xl font-bold text-slate-800">{r.beds} beds</p>
                        <p className="text-sm text-slate-600">{fmtDay(r.from)} → {fmtDay(r.to)} · {r.nights} night(s)</p>
                        {avgRate > 0 && <p className="mt-1 text-xs text-slate-500">≈ {cost(r)}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
