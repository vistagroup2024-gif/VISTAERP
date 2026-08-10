import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import AgentHotelForm from "./AgentHotelForm";

export const dynamic = "force-dynamic";

export default async function AgentNewHotel() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "hotel.create")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to create hotel bookings.</div>;
  }
  const sb = createClient();
  const { data: hotels } = await sb.from("hotels").select("id, name, city").eq("is_active", true).order("name");
  return (
    <div className="max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">New Hotel Booking</h1>
      <AgentHotelForm hotels={(hotels ?? []) as any} />
    </div>
  );
}
