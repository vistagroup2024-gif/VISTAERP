import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
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
      .eq("brn_status", "pending").neq("visa_status", "issued"),
    supabase.from("brn_inventory").select("*"),
    supabase.from("brn_consumption").select("*"),
  ]);

  const G = (groups ?? []) as PendGroup[];
  const B = (brns ?? []) as Brn[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  // Date span across all pending groups' occupied nights
  let dates: string[] = [];
  if (G.length) {
    const min = G.reduce((m, g) => (g.arrival_date < m ? g.arrival_date : m), G[0].arrival_date);
    const max = G.reduce((m, g) => (g.departure_date > m ? g.departure_date : m), G[0].departure_date);
    dates = nightsBetween(min, max);
  }

  const rows = dates.map((d) => {
    const groupsHere = G.filter((g) => g.arrival_date <= d && g.departure_date > d);
    const required = groupsHere.reduce((s, g) => s + g.pax, 0);
    let available = 0;
    for (const b of B) {
      if (b.check_in <= d && b.check_out > d) available += b.beds - usedOnNight(d, consByBrn[b.id] ?? []);
    }
    const shortage = Math.max(0, required - available);
    return { date: d, groups: groupsHere.length, groupNos: groupsHere.map((g) => g.group_no), required, available, shortage };
  }).filter((r) => r.required > 0);

  const totalPendingGroups = G.length;
  const totalPilgrims = G.reduce((s, g) => s + g.pax, 0);
  const totalRequired = rows.reduce((s, r) => s + r.required, 0);
  const totalAvailable = rows.reduce((s, r) => s + r.available, 0);
  const totalShortage = rows.reduce((s, r) => s + r.shortage, 0);
  const shortageDates = rows.filter((r) => r.shortage > 0);

  function rowTone(r: { required: number; available: number; shortage: number }) {
    if (r.shortage > 0) return "bg-red-50";
    if (r.available - r.required < r.required * 0.2) return "bg-yellow-50";
    return "";
  }

  return (
    <div>
      <PageHeader title="BRN Purchase Planning" />
      <p className="mb-4 text-sm text-slate-500">
        Bed demand from <b>pending</b> groups (not yet allocated) vs. current inventory, per night. Buy BRNs for the red dates before allocating.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Pending Groups" value={totalPendingGroups} />
        <Kpi label="Pending Pilgrims" value={totalPilgrims} />
        <Kpi label="Beds Required (bed-nights)" value={totalRequired} />
        <Kpi label="Beds Available" value={totalAvailable} tone="text-green-600" />
        <Kpi label="Total Shortage" value={totalShortage} tone={totalShortage > 0 ? "text-red-600" : "text-slate-800"} />
        <Kpi label="Dates Short" value={shortageDates.length} tone={shortageDates.length > 0 ? "text-red-600" : "text-slate-800"} />
      </div>

      {shortageDates.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-2 font-semibold text-red-700">🛒 BRN Purchase Required</p>
          <ul className="space-y-1 text-sm text-red-700">
            {shortageDates.map((r) => (
              <li key={r.date}>• <b>{fmtDay(r.date)}</b> → Purchase at least <b>{r.shortage}</b> bed(s)</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex gap-2 text-xs">
        <span className="badge bg-green-100 text-green-700">🟢 Sufficient</span>
        <span className="badge bg-yellow-200 text-yellow-900">🟡 Low</span>
        <span className="badge bg-red-500 text-white">🔴 Purchase required</span>
      </div>

      <div className="mt-3 card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Date</th>
              <th className="th">Groups Travelling</th>
              <th className="th text-right">Beds Required</th>
              <th className="th text-right">Beds Available</th>
              <th className="th text-right">Beds Short</th>
              <th className="th">Purchase?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className={`border-t border-slate-100 ${rowTone(r)}`}>
                <td className="td font-medium">{fmtDay(r.date)}</td>
                <td className="td text-sm text-slate-500">{r.groups} ({r.groupNos.join(", ")})</td>
                <td className="td text-right font-medium">{r.required}</td>
                <td className="td text-right">{r.available}</td>
                <td className="td text-right font-semibold text-red-600">{r.shortage || ""}</td>
                <td className="td">
                  {r.shortage > 0
                    ? <span className="badge bg-red-500 text-white">Yes — {r.shortage}</span>
                    : <span className="badge bg-green-100 text-green-700">No</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>No pending groups to plan for.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Note: “Available” is total inventory per night. Because each night must be covered by a single BRN, a date may still need a purchase even when the total looks sufficient — the allocation screen enforces the one-BRN-per-night rule.
      </p>
    </div>
  );
}
