import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import GroupActions from "./GroupActions";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: groups }, { data: roles }] = await Promise.all([
    supabase
      .from("umrah_groups")
      .select("id, group_no, group_date, group_name, pax, arrival_date, departure_date, total_nights, brn_status, visa_status, parties:agent_id(name)")
      .order("group_date", { ascending: false })
      .limit(500),
    supabase.from("user_roles").select("role").eq("user_id", user?.id ?? ""),
  ]);

  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  const G = groups ?? [];

  function statusBadge(g: any) {
    if (g.visa_status === "issued") return <span className="badge bg-emerald-600 text-white">Visa Issued</span>;
    if (g.brn_status === "allocated") return <span className="badge bg-green-100 text-green-700">BRN Allocated</span>;
    return <span className="badge bg-yellow-100 text-yellow-800">Pending</span>;
  }

  return (
    <div>
      <PageHeader title="Visa Groups" action={{ href: "/groups/new", label: "+ New Group" }} />
      <p className="mb-4 text-sm text-slate-500">Starting point of visa processing. Open a group to allocate hotel BRNs.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[950px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Group No</th>
              <th className="th">Name</th>
              <th className="th">Agent</th>
              <th className="th text-right">Pax</th>
              <th className="th">Arrival</th>
              <th className="th">Departure</th>
              <th className="th text-right">Nights</th>
              <th className="th">Visa Status</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {G.map((g: any) => (
              <tr key={g.id} className="border-t border-slate-100">
                <td className="td font-mono font-medium">
                  <Link href={`/groups/${g.id}`} className="text-brand hover:underline">{g.group_no}</Link>
                </td>
                <td className="td">{g.group_name ?? "—"}</td>
                <td className="td text-slate-500">{g.parties?.name ?? "—"}</td>
                <td className="td text-right font-medium">{g.pax}</td>
                <td className="td text-sm">{dateStr(g.arrival_date)}</td>
                <td className="td text-sm">{dateStr(g.departure_date)}</td>
                <td className="td text-right">{g.total_nights}</td>
                <td className="td">{statusBadge(g)}</td>
                <td className="td">
                  <GroupActions groupId={g.id} brnStatus={g.brn_status} visaStatus={g.visa_status} isAdmin={isAdmin} />
                </td>
              </tr>
            ))}
            {G.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={9}>No groups yet. Click “New Group” to start.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
