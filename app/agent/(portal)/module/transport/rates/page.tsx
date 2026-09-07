import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import RateChartTable from "@/components/transport/RateChartTable";
import { buildRateChart } from "@/lib/transportRateChart";
import AgentPeriods, { type Period } from "./AgentPeriods";
import { todaySA } from "@/lib/saudiTime";

export const dynamic = "force-dynamic";

// This agent's transport rates — route × vehicle, then package × vehicle, by
// rate period. Same chart, same periods and same component the office sees on
// the Rate Master's Agent Fare Chart tab; the prices come from the same two
// database functions, so the two cannot disagree.
export default async function AgentRatesPage({ searchParams }: { searchParams: { on?: string; past?: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.view") && !can(agent, "transport.request")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to Transport.</div>;
  }
  const sb = createClient();

  const { data: periodJson } = await sb.rpc("b2b_transport_rate_periods", { p_token: agent.token });
  const periods: Period[] = (periodJson as Period[]) ?? [];
  // Open on the period in force today, or the last one if they are all behind us.
  const fallback = periods.find((p) => p.current) ?? periods[periods.length - 1];
  const on = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.on ?? "") && periods.some((p) => p.from === searchParams.on)
    ? searchParams.on!
    : fallback?.from ?? todaySA();

  const { data: chartJson } = await sb.rpc("b2b_transport_rate_chart", { p_token: agent.token, p_date: on });
  const chart = buildRateChart(chartJson);
  const openPeriod = periods.find((p) => p.from === on);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Transport Rates</h1>
        <Link href="/agent/module/transport" className="btn-outline text-sm">Back</Link>
      </div>
      <p className="text-sm text-slate-500">
        Your rates by vehicle. Rates are set for a period — pick a period to see what applies then.
      </p>
      <AgentPeriods periods={periods} on={on} />
      {openPeriod && (
        <p className="text-xs text-slate-400">
          Showing {openPeriod.current ? "the rates in force now" : openPeriod.future ? "rates that have not started yet" : "rates that have ended"}.
        </p>
      )}
      <RateChartTable {...chart} />
    </div>
  );
}
