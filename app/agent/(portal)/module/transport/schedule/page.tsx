import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import { dateStr } from "@/lib/format";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import ScheduleTripCard, { Trip } from "./ScheduleTripCard";
import ScheduleDateNav from "./ScheduleDateNav";

export const dynamic = "force-dynamic";

const iso = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export default async function AgentTransportSchedule({ searchParams }: { searchParams: { date?: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.schedule") && !can(agent, "transport.view")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to the Transport Schedule.</div>;
  }

  const today = iso(0);
  const tomorrow = iso(1);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? "") ? searchParams.date! : today;

  const sb = createClient();
  const { data } = await sb.rpc("b2b_transport_schedule", { p_token: agent.token, p_date: date });
  const trips: Trip[] = ((data as any[]) ?? []).filter((t) => t.status !== "cancelled");

  const rel = date === today ? "Today" : date === tomorrow ? "Tomorrow" : null;

  return (
    <div className="max-w-4xl space-y-5">
      <RealtimeRefresh tables={["transport_trips", "transport_bookings"]} pollMs={30000} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Transport Schedule</h1>
        <Link href="/agent/module/transport" className="btn-outline text-sm">All Bookings</Link>
      </div>

      <ScheduleDateNav date={date} today={today} tomorrow={tomorrow} />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">
          {rel ? `${rel} · ` : ""}{dateStr(date)} <span className="text-slate-400">({trips.length} trip{trips.length === 1 ? "" : "s"})</span>
        </h2>
        {trips.length ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{trips.map((t) => <ScheduleTripCard key={t.trip_id} t={t} />)}</div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-400">No trips on this date.</p>
        )}
      </div>
    </div>
  );
}
