import { redirect } from "next/navigation";
import { getAgent, can, agentStatus } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import AgentGroupForm from "../AgentGroupForm";

export const dynamic = "force-dynamic";

export default async function AgentGroupDetail({ params }: { params: { id: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "visa.view_own")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to view visa groups.</div>;
  }
  const supabase = createClient();
  const [{ data: group, error }, { data: airports }] = await Promise.all([
    supabase.rpc("b2b_get_group", { p_token: agent.token, p_group: params.id }),
    supabase.rpc("b2b_airports", { p_token: agent.token }),
  ]);
  if (error || !group) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">Group not found.</div>;
  }
  const g = group as any;
  const st = agentStatus(g.workflow_status, g.visa_status);
  // Editing rights by status: Pending -> full edit (if permitted); Under Process
  // -> view only; Visa Issued -> Hotel Details only.
  const mode = st === "Pending"
    ? (can(agent, "visa.edit_pending") ? "edit" : "view")
    : st === "Visa Issued" ? "hotel" : "view";

  return <AgentGroupForm mode={mode as any} airports={(airports as any[]) ?? []} existing={g} groupId={g.id} agencyName={agent.agency_name} />;
}
