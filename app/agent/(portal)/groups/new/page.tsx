import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import GroupForm from "@/components/GroupForm";

export const dynamic = "force-dynamic";

export default async function NewAgentGroup() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "visa.create")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to create visa groups.</div>;
  }
  const supabase = createClient();
  const { data: airports } = await supabase.rpc("b2b_airports", { p_token: agent.token });
  return (
    <GroupForm
      variant="agent"
      airports={(airports as any[]) ?? []}
      agents={[]}
      companies={[]}
      agencyName={agent.agency_name}
      canAgentBrn={can(agent, "brn.add_agent")}
    />
  );
}
