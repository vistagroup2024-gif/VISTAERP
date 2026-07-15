import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompanyFilter from "@/components/CompanyFilter";
import { dateStr } from "@/lib/format";
import { nightsBetween } from "@/lib/brn";
import MarkUpdatedButton from "./MarkUpdatedButton";

export const dynamic = "force-dynamic";

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

export default async function PackageUpdatesPage({ searchParams }: { searchParams: { company?: string } }) {
  const company = searchParams.company ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const supabase = createClient();

  let q = supabase
    .from("umrah_groups")
    .select("id, group_no, arrival_date, departure_date, covered_from, covered_to, package_status, parties:agent_id(name), group_companies:group_company_id(name)")
    .in("package_status", ["update_required", "updated"])
    .order("covered_from");
  if (company) q = q.eq("group_company_id", company);

  const [{ data: rows }, { data: companies }] = await Promise.all([
    q,
    supabase.from("group_companies").select("id, name").order("name"),
  ]);

  const items = (rows ?? []).map((g: any) => {
    const stay = nightsBetween(g.arrival_date, g.departure_date);
    const covered = g.covered_from && g.covered_to ? new Set(nightsBetween(g.covered_from, g.covered_to)) : new Set<string>();
    const remaining = stay.filter((n) => !covered.has(n));
    // Deadline: fix the missing-front nights before arrival; else extend before current checkout.
    const deadline = g.covered_from && g.covered_from > g.arrival_date ? g.arrival_date : g.covered_to;
    const daysLeft = deadline ? Math.round((+new Date(deadline + "T00:00:00Z") - +new Date(today + "T00:00:00Z")) / 86400000) : null;
    let priority = "Normal", pcls = "bg-slate-100 text-slate-600";
    if (g.package_status === "update_required" && daysLeft !== null) {
      if (daysLeft < 0) { priority = "Overdue"; pcls = "bg-red-500 text-white"; }
      else if (daysLeft <= 3) { priority = "Urgent"; pcls = "bg-orange-400 text-white"; }
      else if (daysLeft <= 7) { priority = "Soon"; pcls = "bg-yellow-200 text-yellow-900"; }
    }
    return { g, remaining: remaining.length, deadline, daysLeft, priority, pcls };
  });

  const pending = items.filter((i) => i.g.package_status === "update_required");
  const overdue = pending.filter((i) => i.priority === "Overdue").length;

  return (
    <div>
      <PageHeader title="Package Update Management" />
      <CompanyFilter companies={companies ?? []} value={company} />
      <p className="mb-4 text-sm text-slate-500">
        Groups whose Nusuk package was created with partial hotel coverage. Update the package (arrival, flight, and hotel nights) before the deadline, then mark it updated.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Updates Required" value={pending.length} tone={pending.length > 0 ? "text-orange-600" : "text-slate-800"} />
        <Kpi label="Overdue" value={overdue} tone={overdue > 0 ? "text-red-600" : "text-slate-800"} />
        <Kpi label="Updated (history)" value={items.length - pending.length} tone="text-blue-600" />
        <Kpi label="Total Tracked" value={items.length} />
      </div>

      {overdue > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠️ <b>{overdue}</b> package update(s) are past their deadline. Update these in Nusuk immediately.
        </div>
      )}

      <div className="mt-4 card overflow-x-auto p-0">
        <table className="w-full min-w-[1080px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Group No</th>
              <th className="th">Company</th>
              <th className="th">Agent</th>
              <th className="th">Arrival</th>
              <th className="th">Departure</th>
              <th className="th">Current Hotel Coverage</th>
              <th className="th">Remaining Nights</th>
              <th className="th">Update Deadline</th>
              <th className="th">Priority</th>
              <th className="th">Status</th>
              <th className="th">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.g.id} className={`border-t border-slate-100 ${i.priority === "Overdue" ? "bg-red-50" : ""}`}>
                <td className="td font-mono font-medium">
                  <Link href={`/groups/${i.g.id}`} className="text-brand hover:underline">{i.g.group_no}</Link>
                </td>
                <td className="td text-slate-500">{i.g.group_companies?.name ?? "—"}</td>
                <td className="td text-slate-500">{i.g.parties?.name ?? "—"}</td>
                <td className="td text-sm">{dateStr(i.g.arrival_date)}</td>
                <td className="td text-sm">{dateStr(i.g.departure_date)}</td>
                <td className="td text-sm">{i.g.covered_from ? `${dateStr(i.g.covered_from)} → ${dateStr(i.g.covered_to)}` : "—"}</td>
                <td className="td font-semibold text-orange-600">{i.remaining}</td>
                <td className="td text-sm">{i.deadline ? dateStr(i.deadline) : "—"}{i.daysLeft !== null && i.g.package_status === "update_required" ? ` (${i.daysLeft}d)` : ""}</td>
                <td className="td">{i.g.package_status === "update_required" ? <span className={`badge ${i.pcls}`}>{i.priority}</span> : <span className="text-slate-300">—</span>}</td>
                <td className="td">
                  {i.g.package_status === "updated"
                    ? <span className="badge bg-blue-100 text-blue-700">Package Updated</span>
                    : <span className="badge bg-orange-100 text-orange-700">Update Required</span>}
                </td>
                <td className="td">
                  {i.g.package_status === "update_required" && <MarkUpdatedButton groupId={i.g.id} />}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={11}>No packages need updates. 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
