import { redirect } from "next/navigation";
import { getAgent, can, agentStatus } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import GroupForm from "@/components/GroupForm";

export const dynamic = "force-dynamic";

export default async function AgentGroupDetail({ params }: { params: { id: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "visa.view_own")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to view visa groups.</div>;
  }
  const supabase = createClient();
  const [{ data: group, error }, { data: airports }, { data: companies }] = await Promise.all([
    supabase.rpc("b2b_get_group", { p_token: agent.token, p_group: params.id }),
    supabase.rpc("b2b_airports", { p_token: agent.token }),
    supabase.rpc("b2b_companies", { p_token: agent.token }),
  ]);
  if (error || !group) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">Group not found.</div>;
  }
  const g = group as any;
  const st = agentStatus(g.workflow_status, g.visa_status);
  // Pending -> full edit (if permitted); Visa Issued -> Hotel Details only;
  // any other status (Under Processing / Payment Required / Package Assigned / Rejected) -> read-only.
  const canEditPending = can(agent, "visa.edit_pending");
  const hotelOnly = st === "Visa Issued";
  // Masar groups carry agent-provided BRNs: the agent may keep editing them until
  // the admin marks the group Package Assigned (then everything locks). Non-Masar
  // groups keep the original rule (editable only while Pending).
  const masarEditable =
    g.visa_type === "masar" && canEditPending &&
    !["package_assigned", "visa_issued", "rejected"].includes(g.workflow_status);
  const lockAll = !hotelOnly && !((st === "Pending" && canEditPending) || masarEditable);

  return (
    <GroupForm
      variant="agent"
      airports={(airports as any[]) ?? []}
      agents={[]}
      companies={(companies as any[]) ?? []}
      existing={g}
      groupId={g.id}
      agencyName={agent.agency_name}
      lockAll={lockAll}
      hotelOnly={hotelOnly}
      canAgentBrn={can(agent, "brn.add_agent")}
      canRecommend={can(agent, "visa.recommend")}
    />
  );
}
