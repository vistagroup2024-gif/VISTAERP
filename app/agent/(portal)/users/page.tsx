import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import { PERMISSION_CATALOG } from "@/lib/permissions";
import AgentUsers from "./AgentUsers";

export const dynamic = "force-dynamic";

export default async function AgentUsersPage() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "agency.manage_users")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to manage users.</div>;
  }
  const sb = createClient();
  const { data } = await sb.rpc("b2b_list_users", { p_token: agent.token });

  // A manager can only grant permissions they themselves hold.
  const grantable = PERMISSION_CATALOG
    .map((g) => ({ module: g.module, perms: g.perms.filter((p) => agent.permissions?.[p.key]) }))
    .filter((g) => g.perms.length > 0);

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Users</h1>
        <p className="text-sm text-slate-500">Create staff logins for {agent.agency_name}. You can only grant access you have yourself.</p>
      </div>
      <AgentUsers users={(data as any[]) ?? []} grantable={grantable} />
    </div>
  );
}
