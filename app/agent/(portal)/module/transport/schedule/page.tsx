import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import RealtimeRefresh from "@/components/RealtimeRefresh";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700", assigned: "bg-indigo-100 text-indigo-700",
  on_route: "bg-cyan-100 text-cyan-700", picked_up: "bg-teal-100 text-teal-700",
  completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
  outsourced: "bg-purple-100 text-purple-700", outsource_required: "bg-orange-100 text-orange-700",
};

interface Trip {
  trip_id: string; booking_id: string; booking_no: string | null; passenger_name: string | null; group_no: string | null;
  route: string | null; trip_date: string | null; trip_time: string | null; status: string;
  vehicle: string | null; flight_no: string | null; driver_name: string | null; driver_mobile: string | null;
  is_arrival: boolean; is_departure: boolean;
}

function TripCard({ t }: { t: Trip }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">{t.route ?? "—"}</div>
          <div className="text-xs text-slate-500">
            {t.passenger_name ?? "—"}{t.group_no ? ` · Group ${t.group_no}` : ""}{t.booking_no ? ` · ${t.booking_no}` : ""}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[t.status] ?? "bg-slate-200 text-slate-600"}`}>{t.status.replace(/_/g, " ")}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-600">
        <span>📅 {t.trip_date ?? "—"} {t.trip_time ? `· ${t.trip_time}` : ""}</span>
        {t.flight_no && <span>✈️ {t.flight_no}</span>}
        <span>🚐 {t.vehicle ?? <span className="text-slate-400">vehicle pending</span>}</span>
        <span>🧑‍✈️ {t.driver_name ? `${t.driver_name}${t.driver_mobile ? ` · ${t.driver_mobile}` : ""}` : <span className="text-slate-400">driver pending</span>}</span>
      </div>
    </div>
  );
}

function Section({ title, trips, empty }: { title: string; trips: Trip[]; empty: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title} <span className="text-slate-400">({trips.length})</span></h2>
      {trips.length ? <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{trips.map((t) => <TripCard key={t.trip_id} t={t} />)}</div>
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

  const todays = trips.filter((t) => t.trip_date === today && t.status !== "cancelled");
  const tomorrows = trips.filter((t) => t.trip_date === tmr && t.status !== "cancelled");
  const arrivals = trips.filter((t) => t.is_arrival && isFuture(t.trip_date) && t.status !== "cancelled");
  const departures = trips.filter((t) => t.is_departure && isFuture(t.trip_date) && t.status !== "cancelled");

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
