import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import AgentGroupForm from "../AgentGroupForm";

export const dynamic = "force-dynamic";

export default async function NewAgentGroup() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "visa.create")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to create visa groups.</div>;
  }
  const supabase = createClient();
  const { data: airports } = await supabase.rpc("b2b_airports", { p_token: agent.token });
  return <AgentGroupForm mode="create" airports={(airports as any[]) ?? []} />;
}
