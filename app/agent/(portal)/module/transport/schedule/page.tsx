import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import ScheduleTripCard, { Trip } from "./ScheduleTripCard";

export const dynamic = "force-dynamic";

function Section({ title, trips, empty }: { title: string; trips: Trip[]; empty: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title} <span className="text-slate-400">({trips.length})</span></h2>
      {trips.length ? <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{trips.map((t) => <ScheduleTripCard key={t.trip_id} t={t} />)}</div>
        : <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">{empty}</p>}
    </div>
  );
}

export default async function AgentTransportSchedule() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.schedule") && !can(agent, "transport.view")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to the Transport Schedule.</div>;
  }
  const sb = createClient();
  const { data } = await sb.rpc("b2b_transport_schedule", { p_token: agent.token });
  const trips: Trip[] = (data as any[]) ?? [];

  const today = new Date().toISOString().slice(0, 10);
  const tmr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const isFuture = (d: string | null) => !!d && d >= today;
  const active = (t: Trip) => t.status !== "cancelled";
  const notDone = (t: Trip) => t.status !== "completed" && t.status !== "cancelled";

  const todays = trips.filter((t) => t.trip_date === today && active(t));
  const tomorrows = trips.filter((t) => t.trip_date === tmr && active(t));
  // Upcoming lists exclude completed (and cancelled) trips.
  const arrivals = trips.filter((t) => t.is_arrival && isFuture(t.trip_date) && notDone(t));
  const departures = trips.filter((t) => t.is_departure && isFuture(t.trip_date) && notDone(t));

  return (
    <div className="max-w-4xl space-y-6">
      <RealtimeRefresh tables={["transport_trips", "transport_bookings"]} pollMs={30000} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Transport Schedule</h1>
        <Link href="/agent/module/transport" className="btn-outline text-sm">All Bookings</Link>
      </div>
      <p className="text-sm text-slate-500">A read-only view of your trips. Driver &amp; vehicle appear once Vista assigns them.</p>
      <Section title="Today’s Trips" trips={todays} empty="No trips today." />
      <Section title="Tomorrow’s Trips" trips={tomorrows} empty="No trips tomorrow." />
      <Section title="Upcoming Arrivals" trips={arrivals} empty="No upcoming arrivals." />
      <Section title="Upcoming Departures" trips={departures} empty="No upcoming departures." />
    </div>
  );
}
