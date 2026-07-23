import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can, agentStatus } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import { dateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = {
  "Pending": "bg-yellow-100 text-yellow-800",
  "Under Process": "bg-blue-100 text-blue-700",
  "Visa Issued": "bg-emerald-600 text-white",
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">My Visa Groups</h1>
        {can(agent, "visa.create") && <Link href="/agent/groups/new" className="btn text-sm">+ New Visa Group</Link>}
      </div>
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[820px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Group No</th><th className="th">Name</th><th className="th">Company</th>
              <th className="th">Pax</th><th className="th">Arrival</th><th className="th">Departure</th>
              <th className="th">Status</th><th className="th">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const st = agentStatus(g.workflow_status, g.visa_status);
              return (
                <tr key={g.id} className="border-t border-slate-100">
                  <td className="td font-mono font-medium">{g.group_no}</td>
                  <td className="td">{g.group_name ?? "—"}</td>
                  <td className="td text-slate-500">{g.company ?? "—"}</td>
                  <td className="td">{g.pax}</td>
                  <td className="td text-sm">{dateStr(g.arrival_date)}</td>
                  <td className="td text-sm">{dateStr(g.departure_date)}</td>
                  <td className="td"><span className={`badge ${STATUS_CLS[st]}`}>{st}</span></td>
                  <td className="td"><Link href={`/agent/groups/${g.id}`} className="text-brand text-sm hover:underline">Open →</Link></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No visa groups yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
