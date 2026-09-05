import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import RateChartTable from "@/components/transport/RateChartTable";
import { buildRateChart } from "@/lib/transportRateChart";
import AgentPicker from "./AgentPicker";

export const dynamic = "force-dynamic";

// Agent Fare Chart — what we are offering each agent, as the agent sees it.
//
// This is the SAME chart the agent opens in their own portal: the same table
// component, the same shaping, and every price resolved by the same two database
// functions (transport_agent_rate, transport_package_price). Nobody has to read
// effective-dated rate rows on the Rate Master and work it out by hand, and the
// office can never quote a number the agent's screen does not show.
export default async function AgentFareChartPage({ searchParams }: { searchParams: { agent?: string; on?: string } }) {
  await guardStaffPage("transport.masters");
  const sb = createClient();

  const { data: partyJson } = await sb.rpc("transport_rate_chart_parties");
  const parties: any[] = (partyJson as any[]) ?? [];

  // No agent chosen is not an empty screen: it is the STANDARD chart, the rate an
  // agent with nothing of their own is quoted.
  const agent = searchParams.agent && parties.some((p) => p.party_id === searchParams.agent) ? searchParams.agent : null;
  const on = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.on ?? "") ? searchParams.on! : null;

  const { data: chartJson, error } = await sb.rpc("transport_agent_rate_chart", {
    p_party: agent,
    ...(on ? { p_date: on } : {}),
  });
  const m: any = chartJson ?? {};
  const chart = buildRateChart(m);

  const chosen = parties.find((p) => p.party_id === agent);
  const own = Number(m.own_rate_cells ?? 0) + Number(m.own_price_cells ?? 0);
  const cells = chart.routeRows.reduce((n, r) => n + r.cells.filter((c) => c != null).length, 0)
    + chart.packageRows.reduce((n, r) => n + r.cells.filter((c) => c != null).length, 0);

  return (
    <div className="max-w-5xl">
      <PageHeader title="Agent Fare Chart" subtitle="The selling rates an agent is offered — the same chart they see when they sign in.">
        <PrintButton />
        <Link href="/transport/rates" className="btn-outline text-sm no-print">Rate Master</Link>
      </PageHeader>

      <AgentPicker parties={parties} agent={agent} on={on ?? (m.as_of ?? "")} />

      {error && <div className="card text-red-600">{error.message}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
          {chosen ? chosen.name : "Standard rate — no agent"}
        </span>
        {chosen && !chosen.has_login && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700" title="Priced, but has no portal login to see it with">
            no portal login
          </span>
        )}
        <span className="text-slate-500">
          {cells} price{cells === 1 ? "" : "s"}
          {chosen && (own > 0
            ? ` · ${own} set for this agent, the rest are the standard rate`
            : " · all at the standard rate")}
        </span>
        {m.as_of && <span className="text-slate-400">as on {m.as_of}</span>}
      </div>

      {cells === 0
        ? <div className="card text-sm text-slate-500">No rates are effective on this date.</div>
        : <RateChartTable {...chart} />}
    </div>
  );
}
