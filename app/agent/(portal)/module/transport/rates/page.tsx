import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import AgentRatesTable from "./AgentRatesTable";

export const dynamic = "force-dynamic";

// Active transport rates for this agent — route × vehicle, so they know current pricing.
export default async function AgentRatesPage() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.view") && !can(agent, "transport.request")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to Transport.</div>;
  }
  const sb = createClient();
  const { data: masters } = await sb.rpc("b2b_transport_masters", { p_token: agent.token });
  const m: any = masters ?? {};
  const routes: any[] = m.routes ?? [];
  const vehicles: any[] = m.vehicles ?? [];
  const rates: any[] = m.rates ?? [];

  // Rates are already resolved to this agent's price (agent-specific override applied
  // server-side), keyed by route|vehicle.
  const rate = new Map<string, number>();
  rates.forEach((r: any) => { if (r.sell_rate != null) rate.set(`${r.route_id}|${r.vehicle_id}`, Number(r.sell_rate)); });

  // Only vehicles that have at least one rate, and routes that have at least one.
  const usedVeh = vehicles.filter((v: any) => routes.some((rt: any) => rate.has(`${rt.id}|${v.id}`)));
  const rows = routes
    .map((rt: any) => ({ id: rt.id, name: rt.name, cells: usedVeh.map((v: any) => rate.get(`${rt.id}|${v.id}`) ?? null) }))
    .filter((r: any) => r.cells.some((c: number | null) => c != null));

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Transport Rates</h1>
        <Link href="/agent/module/transport" className="btn-outline text-sm">Back</Link>
      </div>
      <p className="text-sm text-slate-500">Your active rates by route and vehicle ({agent.currency ?? "SAR"}).</p>
      <AgentRatesTable vehicles={usedVeh.map((v: any) => ({ id: v.id, name: v.name }))} rows={rows} currency={agent.currency ?? "SAR"} />
    </div>
  );
}
