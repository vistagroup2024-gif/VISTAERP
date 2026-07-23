import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

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
  if (!agent) redirect("/agent/login");
  const supabase = createClient();
  const { data } = await supabase.rpc("b2b_dashboard", { p_token: agent.token });
  const d = (data as any) ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Welcome, {agent.agency_name}</h1>
        <p className="text-sm text-slate-500">Your visa operations at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Total Visa Applications" value={d.total_applications ?? 0} />
        <Kpi label="Pending Visas" value={d.pending_visas ?? 0} tone="text-orange-600" />
        <Kpi label="Visa Issued" value={d.visa_issued ?? 0} tone="text-emerald-600" />
        <Kpi label="Pending Package Updates" value={d.pending_package_updates ?? 0} tone="text-amber-600" />
        <Kpi label="Total Pilgrims" value={d.total_pax ?? 0} />
      </div>

      {can(agent, "fin.credit") && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Credit Limit" value={d.credit_limit ? money(d.credit_limit, d.currency ?? "SAR") : "—"} tone="text-brand" />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {can(agent, "visa.view_own") && <Link href="/agent/groups" className="btn">View My Visa Groups →</Link>}
        {can(agent, "visa.create") && <span className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-400">Create Visa Group (coming soon)</span>}
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="mb-2 font-semibold text-slate-700">Your enabled modules</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(agent.permissions ?? {}).filter(([, v]) => v).map(([k]) => (
            <span key={k} className="rounded-full bg-brand/10 px-3 py-1 text-xs text-brand-dark">{k}</span>
          ))}
          {Object.values(agent.permissions ?? {}).every((v) => !v) && <span className="text-sm text-slate-400">No modules enabled yet — contact Vista Group.</span>}
        </div>
      </div>
    </div>
  );
}
