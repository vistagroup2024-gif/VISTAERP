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

export default async function PackageUpdatesPage({ searchParams }: { searchParams: { company?: string; tab?: string } }) {
  const company = searchParams.company ?? "";
  const tab = searchParams.tab === "history" ? "history" : "pending";
  const today = new Date().toISOString().slice(0, 10);
  const supabase = createClient();

  // Monitor inventory: flip update_required <-> update_available as stock changes
  await supabase.rpc("refresh_update_availability");

  const [{ data: companies }] = await Promise.all([
    supabase.from("group_companies").select("id, name").order("name"),
  ]);
  const companyName = (companies ?? []).find((c: any) => c.id === company)?.name;

  const TabLink = ({ id, label }: { id: string; label: string }) => {
    const p = new URLSearchParams(); if (company) p.set("company", company); p.set("tab", id);
    return (
      <Link href={`/groups/package-updates?${p.toString()}`}
        className={`rounded-t-lg px-4 py-2 text-sm font-medium ${tab === id ? "bg-white text-brand shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
        {label}
      </Link>
    );
  };

  return (
    <div>
      <PageHeader title="Package Update Management" />
      <CompanyFilter companies={companies ?? []} value={company} />
      <div className="flex gap-1 border-b border-slate-200">
        <TabLink id="pending" label="Pending Updates" />
        <TabLink id="history" label="Update History" />
      </div>
      <div className="pt-4">
        {tab === "pending"
          ? <PendingTab company={company} today={today} />
          : <HistoryTab companyName={companyName} />}
      </div>
    </div>
  );
}

async function PendingTab({ company, today }: { company: string; today: string }) {
  const supabase = createClient();
  let q = supabase
    .from("umrah_groups")
    .select("id, group_no, arrival_date, departure_date, covered_from, covered_to, package_status, parties:agent_id(name), group_companies:group_company_id(name)")
    .in("package_status", ["update_required", "update_available", "update_ready"])
    .order("arrival_date");
  if (company) q = q.eq("group_company_id", company);
  const { data: rows } = await q;
  const R = rows ?? [];

  const ids = R.map((g: any) => g.id);
  const { data: allocs } = ids.length
    ? await supabase.from("group_brn_allocation").select("group_id, brn_consumption:consumption_id(check_in, check_out)").in("group_id", ids)
    : { data: [] as any[] };
  const coveredByGroup: Record<string, Set<string>> = {};
  (allocs ?? []).forEach((a: any) => {
    if (!a.brn_consumption) return;
    const set = (coveredByGroup[a.group_id] ||= new Set());
    nightsBetween(a.brn_consumption.check_in, a.brn_consumption.check_out).forEach((n: string) => set.add(n));
  });

  const items = R.map((g: any) => {
    const stay = nightsBetween(g.arrival_date, g.departure_date);
    const covered = coveredByGroup[g.id] ?? new Set<string>();
    const remaining = stay.filter((n: string) => !covered.has(n));
    const deadline = g.covered_from && g.covered_from > g.arrival_date ? g.arrival_date : g.covered_to;
    const daysLeft = deadline ? Math.round((+new Date(deadline + "T00:00:00Z") - +new Date(today + "T00:00:00Z")) / 86400000) : null;
    let priority = "Normal", pcls = "bg-slate-100 text-slate-600";
    if (daysLeft !== null) {
      if (daysLeft < 0) { priority = "Overdue"; pcls = "bg-red-500 text-white"; }
      else if (daysLeft <= 3) { priority = "Urgent"; pcls = "bg-orange-400 text-white"; }
      else if (daysLeft <= 7) { priority = "Soon"; pcls = "bg-yellow-200 text-yellow-900"; }
    }
    return { g, remaining: remaining.length, deadline, daysLeft, priority, pcls };
  });

  const available = items.filter((i: any) => i.g.package_status === "update_available");
  const ready = items.filter((i: any) => i.g.package_status === "update_ready");
  const overdue = items.filter((i: any) => i.priority === "Overdue").length;

  const statusBadge = (s: string) =>
    s === "update_ready" ? <span className="badge bg-amber-100 text-amber-800">Ready for Nusuk Update</span>
      : s === "update_available" ? <span className="badge bg-teal-100 text-teal-700">Ready for Package Update</span>
      : <span className="badge bg-orange-100 text-orange-700">Update Required (no inventory)</span>;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Pending" value={items.length} tone={items.length > 0 ? "text-orange-600" : "text-slate-800"} />
        <Kpi label="Ready for Package Update" value={available.length} tone={available.length > 0 ? "text-teal-600" : "text-slate-800"} />
        <Kpi label="Ready for Nusuk" value={ready.length} tone={ready.length > 0 ? "text-amber-600" : "text-slate-800"} />
        <Kpi label="Overdue" value={overdue} tone={overdue > 0 ? "text-red-600" : "text-slate-800"} />
      </div>
      {available.length > 0 && (
        <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          🔔 <b>{available.length}</b> package(s) can now be completed — BRN inventory is available. Open the group and click <b>Update Package</b>.
        </div>
      )}
      <div className="mt-4 card overflow-x-auto p-0">
        <table className="w-full min-w-[1120px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Group No</th><th className="th">Company</th><th className="th">Agent</th>
              <th className="th">Arrival</th><th className="th">Departure</th><th className="th">Current Hotel Coverage</th>
              <th className="th">Remaining Nights</th><th className="th">Update Deadline</th><th className="th">Priority</th>
              <th className="th">Status</th><th className="th">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i: any) => (
              <tr key={i.g.id} className={`border-t border-slate-100 ${i.priority === "Overdue" ? "bg-red-50" : ""}`}>
                <td className="td font-mono font-medium"><Link href={`/groups/${i.g.id}`} className="text-brand hover:underline">{i.g.group_no}</Link></td>
                <td className="td text-slate-500">{i.g.group_companies?.name ?? "—"}</td>
                <td className="td text-slate-500">{i.g.parties?.name ?? "—"}</td>
                <td className="td text-sm">{dateStr(i.g.arrival_date)}</td>
                <td className="td text-sm">{dateStr(i.g.departure_date)}</td>
                <td className="td text-sm">{i.g.covered_from ? `${dateStr(i.g.covered_from)} → ${dateStr(i.g.covered_to)}` : "—"}</td>
                <td className="td font-semibold text-orange-600">{i.remaining}</td>
                <td className="td text-sm">{i.deadline ? dateStr(i.deadline) : "—"}{i.daysLeft !== null ? ` (${i.daysLeft}d)` : ""}</td>
                <td className="td"><span className={`badge ${i.pcls}`}>{i.priority}</span></td>
                <td className="td">{statusBadge(i.g.package_status)}</td>
                <td className="td">
                  {i.g.package_status === "update_ready"
                    ? <MarkUpdatedButton groupId={i.g.id} />
                    : i.g.package_status === "update_available"
                    ? <Link href={`/groups/${i.g.id}`} className="rounded bg-teal-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-700">Update Package →</Link>
                    : <Link href={`/groups/${i.g.id}`} className="text-slate-400 text-sm hover:underline">Awaiting inventory</Link>}
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td className="td text-slate-400" colSpan={11}>No pending package updates. 🎉</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function HistoryTab({ companyName }: { companyName?: string }) {
  const supabase = createClient();
  const { data: rows } = await supabase.from("package_update_history").select("*").order("updated_at", { ascending: false }).limit(1000);
  const H = (rows ?? []).filter((r: any) => !companyName || r.company_name === companyName);
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[1080px]">
        <thead className="bg-slate-50">
          <tr>
            <th className="th">Group No</th><th className="th">Agent</th><th className="th">Company</th>
            <th className="th">Arrival</th><th className="th">Departure</th><th className="th">Previous BRNs</th>
            <th className="th">Newly Added BRNs</th><th className="th">Updated By</th><th className="th">Updated Date & Time</th>
          </tr>
        </thead>
        <tbody>
          {H.map((r: any) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="td font-mono font-medium">{r.group_id ? <Link href={`/groups/${r.group_id}`} className="text-brand hover:underline">{r.group_no}</Link> : r.group_no}</td>
              <td className="td text-slate-500">{r.agent_name ?? "—"}</td>
              <td className="td text-slate-500">{r.company_name ?? "—"}</td>
              <td className="td text-sm">{dateStr(r.arrival_date)}</td>
              <td className="td text-sm">{dateStr(r.departure_date)}</td>
              <td className="td text-sm">{r.prev_brns ?? "—"}</td>
              <td className="td text-sm text-teal-700">{r.new_brns ?? "—"}</td>
              <td className="td text-sm text-slate-500">{r.updated_by_name ?? "Staff"}</td>
              <td className="td text-sm text-slate-500">{new Date(r.updated_at).toLocaleString()}</td>
            </tr>
          ))}
          {H.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No completed package updates yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
