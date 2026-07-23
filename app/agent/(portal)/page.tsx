import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

export default async function AgentDashboard() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  // Dashboard is permission-gated; send agents without it to their first module.
  if (!can(agent, "dashboard.view")) {
    if (can(agent, "visa.view_own")) redirect("/agent/groups");
    redirect("/agent/profile");
  }
  const supabase = createClient();
  const { data } = await supabase.rpc("b2b_dashboard", { p_token: agent.token });
  const d = (data as any) ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Welcome, {agent.agency_name}</h1>
        <p className="text-sm text-slate-500">Your visa operations at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total Groups" value={d.total_applications ?? 0} />
        <Kpi label="Pending Groups" value={d.pending_visas ?? 0} tone="text-orange-600" />
        <Kpi label="Groups Issued" value={d.visa_issued ?? 0} tone="text-emerald-600" />
        <Kpi label="Total Pilgrims" value={d.total_pax ?? 0} tone="text-brand" />
      </div>

      <div className="flex flex-wrap gap-3">
        {can(agent, "visa.view_own") && <Link href="/agent/groups" className="btn">View My Visa Groups →</Link>}
        {can(agent, "visa.create") && <Link href="/agent/groups/new" className="btn-outline">+ New Visa Group</Link>}
      </div>
    </div>
  );
}
