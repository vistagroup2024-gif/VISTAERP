import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import TransportBookingForm from "@/components/TransportBookingForm";

export const dynamic = "force-dynamic";

export default async function AgentNewTransport({ searchParams }: { searchParams: { nusuk?: string; pax?: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.request")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to request transport.</div>;
  }
  const sb = createClient();
  const { data } = await sb.rpc("b2b_transport_masters", { p_token: agent.token });
  const m: any = data ?? {};

  return (
    <div className="max-w-5xl">
      <h1 className="mb-6 text-xl font-bold tracking-tight text-slate-900">New Transport Booking</h1>
      <TransportBookingForm
        existing={null} existingTrips={[]}
        routes={m.routes ?? []} vehicles={m.vehicles ?? []} packages={m.packages ?? []} rates={m.rates ?? []}
        packagePrices={m.packagePrices ?? []} companies={[]} agents={[]}
        variant="agent" endpoint="/api/agent/transport" basePath="/agent/module/transport"
        prefill={{ nusuk_group_no: searchParams.nusuk, pax: searchParams.pax }}
      />
    </div>
  );
}
