import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import AgentTransportTable from "./AgentTransportTable";

export const dynamic = "force-dynamic";

export default async function AgentTransportList({ searchParams }: { searchParams: { created?: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.view") && !can(agent, "transport.request")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to Transport.</div>;
  }
  const sb = createClient();
  const { data } = await sb.rpc("b2b_transport_my_bookings", { p_token: agent.token });
  const rows: any[] = (data as any[]) ?? [];

  return (
    <div className="max-w-5xl">
      <RealtimeRefresh tables={["transport_bookings"]} pollMs={20000} />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Transport Bookings</h1>
        <div className="flex gap-2">
          <Link href="/agent/module/transport/rates" className="btn-outline">💲 Rates</Link>
          <Link href="/agent/module/transport/schedule" className="btn-outline">📅 Schedule</Link>
          {can(agent, "transport.request") && <Link href="/agent/module/transport/new" className="btn">+ New Booking</Link>}
        </div>
      </div>
      {searchParams.created && (
        <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">✓ Booking created successfully.</div>
      )}

      <AgentTransportTable rows={rows as any} token={agent.token} canRequest={can(agent, "transport.request") || can(agent, "transport.modify_own")} />
    </div>
  );
}
