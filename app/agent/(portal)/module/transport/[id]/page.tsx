import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import TransportBookingForm from "@/components/TransportBookingForm";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  draft: "Draft", pending: "Pending Confirmation", confirmed: "Confirmed", assigned: "Assigned",
  on_route: "On Route", picked_up: "Picked Up", completed: "Completed", cancelled: "Cancelled",
};

export default async function AgentTransportDetail({ params }: { params: { id: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "transport.view") && !can(agent, "transport.request")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to Transport.</div>;
  }
  const sb = createClient();
  const [{ data: bundle }, { data: masters }] = await Promise.all([
    sb.rpc("b2b_transport_get_booking", { p_token: agent.token, p_id: params.id }),
    sb.rpc("b2b_transport_masters", { p_token: agent.token }),
  ]);
  if (!bundle) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">Booking not found.</div>;
  }
  const b: any = (bundle as any).booking;
  const trips: any[] = (bundle as any).trips ?? [];
  const m: any = masters ?? {};
  const editable = ["draft", "pending"].includes(b.status) && can(agent, "transport.modify_own");

  if (editable) {
    return (
      <div className="max-w-5xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-800">Booking {b.booking_no}</h1>
        <TransportBookingForm
          existing={b} existingTrips={trips}
          routes={m.routes ?? []} vehicles={m.vehicles ?? []} packages={m.packages ?? []} rates={m.rates ?? []}
          companies={[]} agents={[]}
          variant="agent" endpoint="/api/agent/transport" basePath="/agent/module/transport"
        />
      </div>
    );
  }

  // Locked (confirmed and beyond, or no modify permission): read-only summary.
  const rName = new Map<string, string>((m.routes ?? []).map((r: any) => [r.id as string, r.name as string]));
  const vName = new Map<string, string>((m.vehicles ?? []).map((v: any) => [v.id as string, v.name as string]));
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Booking {b.booking_no}</h1>
        <Link href="/agent/module/transport" className="btn-outline text-sm">Back</Link>
      </div>
      <div className="card">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{LABEL[b.status] ?? b.status}</span>
        <p className="mt-2 text-sm text-slate-500">This booking is locked and can no longer be edited. Contact Vista Group for changes.</p>
      </div>
      <div className="card grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div><div className="text-xs text-slate-400">Passenger</div>{b.passenger_name ?? "—"}</div>
        <div><div className="text-xs text-slate-400">Mobile</div>{b.mobile ?? "—"}</div>
        <div><div className="text-xs text-slate-400">Passengers</div>{b.pax ?? "—"}</div>
        <div><div className="text-xs text-slate-400">Date</div>{b.booking_date ?? "—"}</div>
        <div><div className="text-xs text-slate-400">Total</div>{Number(b.total_amount).toFixed(2)} {b.currency}</div>
      </div>
      <div className="card p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">#</th><th className="th">Route</th><th className="th">Date</th><th className="th">Time</th><th className="th">Vehicle</th></tr></thead>
          <tbody>
            {trips.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="td">{t.seq}</td>
                <td className="td">{t.route_id ? rName.get(t.route_id) ?? "—" : t.route_label ?? "—"}</td>
                <td className="td">{t.trip_date ?? "—"}</td>
                <td className="td">{t.trip_time?.slice(0, 5) ?? "—"}</td>
                <td className="td">{t.vehicle_id ? vName.get(t.vehicle_id) ?? "—" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
