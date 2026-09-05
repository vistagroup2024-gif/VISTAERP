import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import RateChartTable from "@/components/transport/RateChartTable";
import { buildRateChart } from "@/lib/transportRateChart";

export const dynamic = "force-dynamic";

// Active transport rates for this agent — route × vehicle, then package × vehicle.
// The office sees the same chart, for any agent, at /transport/rates/chart: same
// component, same shaping, and prices resolved by the same database functions.
export default async function AgentRatesPage() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.view") && !can(agent, "transport.request")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to Transport.</div>;
  }
  const sb = createClient();
  const { data: masters } = await sb.rpc("b2b_transport_masters", { p_token: agent.token });
  const chart = buildRateChart(masters);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Transport Rates</h1>
        <Link href="/agent/module/transport" className="btn-outline text-sm">Back</Link>
      </div>
      <p className="text-sm text-slate-500">Your active rates by vehicle.</p>
      <RateChartTable {...chart} />
    </div>
  );
}
