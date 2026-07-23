import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import { dateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

const WF: Record<string, string> = {
  pending: "Pending", brn_allocated: "BRN Allocated", erp_created: "ERP Created",
  package_assigned: "Package Assigned", visa_issued: "Visa Issued",
};

export default async function AgentGroups() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "visa.view_own")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to view visa groups.</div>;
  }
  const supabase = createClient();
  const { data } = await supabase.rpc("b2b_my_groups", { p_token: agent.token });
  const rows = (data as any[]) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">My Visa Groups</h1>
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[820px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Group No</th><th className="th">Name</th><th className="th">Company</th>
              <th className="th">Pax</th><th className="th">Arrival</th><th className="th">Departure</th>
              <th className="th">Status</th>{can(agent, "pkg.view_status") && <th className="th">Package</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className="border-t border-slate-100">
                <td className="td font-mono font-medium">{g.group_no}</td>
                <td className="td">{g.group_name ?? "—"}</td>
                <td className="td text-slate-500">{g.company ?? "—"}</td>
                <td className="td">{g.pax}</td>
                <td className="td text-sm">{dateStr(g.arrival_date)}</td>
                <td className="td text-sm">{dateStr(g.departure_date)}</td>
                <td className="td"><span className="badge bg-slate-100 text-slate-700">{WF[g.workflow_status] ?? g.workflow_status ?? "—"}</span></td>
                {can(agent, "pkg.view_status") && <td className="td text-sm text-slate-500">{g.package_status ?? "—"}</td>}
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No visa groups yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
