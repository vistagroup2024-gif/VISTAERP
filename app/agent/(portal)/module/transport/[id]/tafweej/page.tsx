import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import { dateStr, fmtTime12 } from "@/lib/format";
import TafweejCard, { type TafweejDetails } from "@/components/transport/TafweejCard";

export const dynamic = "force-dynamic";

// Driver Tafweej Details for one booking, in the agent portal. This is the
// page the "Create Tafweej" notification lands on, and what the booking's
// button opens in a new tab: the driver Vista assigned, in the form the tafweej
// asks for, per arrival trip. The text is built by the same routine staff
// read, so the agent copies exactly what the office sees.
//
// A driver shows here only once the day's assignments are CONFIRMED — the same
// moment the agent's schedule starts showing them.
export default async function AgentTafweejPage({ params }: { params: { id: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.view") && !can(agent, "transport.request")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to Transport.</div>;
  }
  const sb = createClient();
  const { data: bundle } = await sb.rpc("b2b_transport_get_booking", { p_token: agent.token, p_id: params.id });
  if (!bundle) return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">Booking not found.</div>;
  const b: any = (bundle as any).booking;
  const trips: any[] = ((bundle as any).trips ?? []).filter((t: any) => !["cancelled"].includes(t.status));

  const details = await Promise.all(trips.map(async (t) => {
    const { data } = await sb.rpc("b2b_trip_tafweej", { p_token: agent.token, p_trip: t.id });
    return { trip: t, d: data as TafweejDetails | null };
  }));

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Driver Tafweej Details · {b.booking_no}</h1>
        <Link href={`/agent/module/transport/${b.id}`} className="btn-outline text-sm">Booking</Link>
      </div>
      <p className="text-sm text-slate-500">
        Use these details to create the Tafweej where the visa was issued. Each trip lists the driver Vista has
        confirmed for it; press <b>Copy Tafweej details</b> and paste.
      </p>

      {details.length === 0 && <div className="card text-sm text-slate-500">This booking has no trips.</div>}

      {details.map(({ trip, d }) => (
        <section key={trip.id} className="space-y-2">
          <div className="text-sm text-slate-600">
            <span className="font-medium text-slate-800">Trip {trip.seq}</span>
            {trip.route_label ? ` · ${trip.route_label}` : ""} · {dateStr(trip.trip_date)}{trip.trip_time ? ` · ${fmtTime12(trip.trip_time)}` : ""}
            {trip.flight_no ? ` · ✈️ ${trip.flight_no}` : ""}
          </div>
          {d ? (
            <TafweejCard d={d}
              notReadyText={d.driver_name === null && !d.confirmed
                ? "The driver for this trip has not been confirmed yet. You will be notified as soon as it is."
                : undefined} />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">Not available.</div>
          )}
        </section>
      ))}
    </div>
  );
}
