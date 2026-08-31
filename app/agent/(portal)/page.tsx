import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import CompanyInquiryButton from "@/components/CompanyInquiryButton";
import { dateStr } from "@/lib/format";

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
  // Dashboard shows only arrivals of today and tomorrow (p_days = 1).
  const { data: pendingArr } = await supabase.rpc("b2b_arrival_compliance", { p_token: agent.token, p_days: 1 });
  const arrivalsPending: any[] = (pendingArr as any[]) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Welcome, {agent.agency_name}</h1>
        <p className="text-sm text-slate-500">Your visa operations at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total Groups" value={d.total_applications ?? 0} />
        <Kpi label="Pending Groups" value={d.pending_visas ?? 0} tone="text-orange-600" />
        <Kpi label="Groups Issued" value={d.visa_issued ?? 0} tone="text-emerald-600" />
        <Kpi label="Arrival Services Pending" value={d.arrival_services_pending ?? 0} tone={(d.arrival_services_pending ?? 0) > 0 ? "text-red-600" : "text-slate-800"} />
      </div>

      {arrivalsPending.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-semibold text-red-800">⚠ Arrival Services Pending ({arrivalsPending.length})</h2>
          <p className="mt-0.5 mb-3 text-xs text-red-700">Arriving today or tomorrow with no Transport booking and no Tafweej. Arrange one before arrival so no pilgrim is missed.</p>
          <ul className="space-y-2">
            {arrivalsPending.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">Group {g.group_no ?? "—"}</span>
                <span className="text-slate-500">{g.pax ?? "?"} pax · arrives {dateStr(g.arrival_date)}{g.days_to_arrival === 0 ? " (today)" : g.days_to_arrival === 1 ? " (tomorrow)" : ""}</span>
                <span className="ml-auto">
                  {can(agent, "transport.request") && (
                    <Link href={`/agent/module/transport/new?nusuk=${encodeURIComponent(g.group_no ?? "")}&pax=${g.pax ?? ""}`} className="rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">Create Transport Booking →</Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {can(agent, "visa.view_own") && <Link href="/agent/groups" className="btn">View My Visa Groups →</Link>}
        {can(agent, "visa.create") && <Link href="/agent/groups/new" className="btn-outline">+ New Visa Group</Link>}
        {can(agent, "visa.recommend") && <CompanyInquiryButton endpoint="/api/agent/recommendation" agentView />}
      </div>
    </div>
  );
}
