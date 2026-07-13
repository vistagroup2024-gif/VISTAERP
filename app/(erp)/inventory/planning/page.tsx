import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { Brn, Consumption, nightsBetween, usedOnNight, fmtDay } from "@/lib/brn";

export const dynamic = "force-dynamic";

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

interface PendGroup { id: string; group_no: string; pax: number; arrival_date: string; departure_date: string; }

export default async function PlanningPage() {
  const supabase = createClient();
  const [{ data: groups }, { data: brns }, { data: cons }] = await Promise.all([
    supabase.from("umrah_groups")
      .select("id, group_no, pax, arrival_date, departure_date")
      .eq("brn_status", "pending").neq("visa_status", "issued")
      .order("arrival_date"),
    supabase.from("brn_inventory").select("*"),
    supabase.from("brn_consumption").select("*"),
  ]);

  const G = (groups ?? []) as PendGroup[];
  const B = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  // One-BRN-per-night rule: a night is coverable only if a SINGLE BRN of the
  // right city has (beds - already consumed) >= the group's pax that night.
  const singleBrnOK = (city: string, night: string, pax: number) =>
    B.some((b) => b.city === city && b.check_in <= night && b.check_out > night
      && (b.beds - usedOnNight(night, consByBrn[b.id] ?? [])) >= pax);

  const analysed = G.map((g) => {
    const nights = nightsBetween(g.arrival_date, g.departure_date);
    const per = nights.map((n) => ({
      n, mak: singleBrnOK("Makkah", n, g.pax), mad: singleBrnOK("Madinah", n, g.pax),
    }));
    // Nights where no single Makkah BRN fits. One of them may be rescued as the
    // (single) Madinah night if a Madinah BRN fits it. Any remaining bad night
    // needs a brand-new BRN with >= pax beds.
    const bad = per.filter((x) => !x.mak);
    let purchaseNights: string[];
    if (bad.length === 0) {
      purchaseNights = [];
    } else {
      const rescuableIdx = bad.findIndex((x) => x.mad);
      purchaseNights = bad.filter((_, i) => i !== rescuableIdx).map((x) => x.n);
    }
    return { g, purchaseNights, feasible: purchaseNights.length === 0 };
  });

  const needing = analysed.filter((a) => !a.feasible);
  const totalPilgrims = G.reduce((s, g) => s + g.pax, 0);
  const datesToBuy = needing.reduce((s, a) => s + a.purchaseNights.length, 0);

  return (
    <div>
      <PageHeader title="BRN Purchase Planning" />
      <p className="mb-4 text-sm text-slate-500">
        For every <b>pending</b> group, each night must be covered by <b>one single BRN</b> with enough beds. If no single BRN fits a night, a new BRN with at least the group’s pax must be purchased (beds from different BRNs cannot be combined for one night).
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Pending Groups" value={G.length} />
        <Kpi label="Pending Pilgrims" value={totalPilgrims} />
        <Kpi label="Ready to Allocate" value={analysed.length - needing.length} tone="text-green-600" />
        <Kpi label="Groups Needing Purchase" value={needing.length} tone={needing.length > 0 ? "text-red-600" : "text-slate-800"} />
        <Kpi label="Nights to Purchase" value={datesToBuy} tone={datesToBuy > 0 ? "text-red-600" : "text-slate-800"} />
      </div>

      {needing.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-2 font-semibold text-red-700">🛒 BRN Purchase Required</p>
          <ul className="space-y-1 text-sm text-red-700">
            {needing.map((a) => (
              <li key={a.g.id}>
                • <b>{a.g.group_no}</b> ({a.g.pax} pax): purchase a BRN with at least <b>{a.g.pax}</b> beds for{" "}
                {a.purchaseNights.map((n) => fmtDay(n)).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex gap-2 text-xs">
        <span className="badge bg-green-100 text-green-700">🟢 Ready</span>
        <span className="badge bg-red-500 text-white">🔴 Purchase required</span>
      </div>

      <div className="mt-3 card overflow-x-auto p-0">
        <table className="w-full min-w-[820px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Group No</th>
              <th className="th">Pax</th>
              <th className="th">Stay</th>
              <th className="th">Nights</th>
              <th className="th">Status</th>
              <th className="th">Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {analysed.map((a) => (
              <tr key={a.g.id} className={`border-t border-slate-100 ${a.feasible ? "" : "bg-red-50"}`}>
                <td className="td font-mono font-medium">{a.g.group_no}</td>
                <td className="td">{a.g.pax}</td>
                <td className="td text-sm">{dateStr(a.g.arrival_date)} → {dateStr(a.g.departure_date)}</td>
                <td className="td">{nightsBetween(a.g.arrival_date, a.g.departure_date).length}</td>
                <td className="td">
                  {a.feasible
                    ? <span className="badge bg-green-100 text-green-700">Ready to allocate</span>
                    : <span className="badge bg-red-500 text-white">Purchase required</span>}
                </td>
                <td className="td text-sm">
                  {a.feasible
                    ? "—"
                    : <span className="text-red-700">Buy BRN ≥ {a.g.pax} beds for {a.purchaseNights.map((n) => fmtDay(n)).join(", ")}</span>}
                </td>
              </tr>
            ))}
            {analysed.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>No pending groups to plan for.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
