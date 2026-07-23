import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can, agentStatus } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import { dateStr } from "@/lib/format";
import AgentGroupsTable, { AgentRow } from "./AgentGroupsTable";

export const dynamic = "force-dynamic";

const PKG_LABEL: Record<string, string> = {
  complete: "Complete", update_required: "Update Required", update_available: "Ready for Update",
  update_ready: "Ready for Nusuk", updated: "Updated",
};

function hotelsSummary(h: any): string {
  if (!Array.isArray(h) || h.length === 0) return "";
  return h.map((x: any) => `${x.hotel || x.city}${x.check_in ? ` (${dateStr(x.check_in)}→${dateStr(x.check_out)})` : ""}`).join("; ");
}

export default async function AgentGroups() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "visa.view_own")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to view visa groups.</div>;
  }
  const supabase = createClient();
  const { data } = await supabase.rpc("b2b_my_groups", { p_token: agent.token });
  const showPackage = can(agent, "pkg.view_status");

  const rows: AgentRow[] = ((data as any[]) ?? []).map((g) => ({
    id: g.id,
    group_no: g.group_no,
    group_name: g.group_name ?? "",
    agent: g.agent ?? "",
    group_date: g.group_date,
    arrival_date: g.arrival_date,
    departure_date: g.departure_date,
    arrival_flight: g.arrival_flight ?? "",
    hotels: hotelsSummary(g.hotel_details),
    pax: g.pax,
    status_label: agentStatus(g.workflow_status, g.visa_status),
    package_label: g.package_status ? (PKG_LABEL[g.package_status] ?? g.package_status) : "",
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">My Visa Groups</h1>
        {can(agent, "visa.create") && <Link href="/agent/groups/new" className="btn text-sm">+ New Visa Group</Link>}
      </div>
      <AgentGroupsTable rows={rows} showPackage={showPackage} />
    </div>
  );
}
