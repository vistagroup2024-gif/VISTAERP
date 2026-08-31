import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { fmtTime12 } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import TransportBookingForm from "@/components/TransportBookingForm";
import AgentCancelRequest from "./AgentCancelRequest";

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
        <h1 className="mb-6 text-xl font-bold tracking-tight text-slate-900">Booking {b.booking_no}</h1>
        <TransportBookingForm
          existing={b} existingTrips={trips}
          routes={m.routes ?? []} vehicles={m.vehicles ?? []} packages={m.packages ?? []} rates={m.rates ?? []}
          packagePrices={m.packagePrices ?? []} companies={[]} agents={[]}
          variant="agent" endpoint="/api/agent/transport" basePath="/agent/module/transport"
        />
      </div>
    );
  }

  // Locked (confirmed and beyond, or no modify permission): full read-only view.
  const rName = new Map<string, string>((m.routes ?? []).map((r: any) => [r.id as string, r.name as string]));
  const vName = new Map<string, string>((m.vehicles ?? []).map((v: any) => [v.id as string, v.name as string]));
  const canCancel = (can(agent, "transport.request") || can(agent, "transport.modify_own")) && !["cancelled", "completed"].includes(b.status);
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Booking {b.booking_no}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/agent/module/transport/${b.id}/voucher?brand=vista`} className="btn-outline text-sm">Vista Voucher</Link>
          <Link href={`/agent/module/transport/${b.id}/voucher?brand=agent`} className="btn-outline text-sm">Agent Voucher</Link>
          {canCancel && <AgentCancelRequest token={agent.token} id={b.id} requested={!!b.cancel_requested} />}
          <Link href="/agent/module/transport" className="btn-outline text-sm">Back</Link>
        </div>
      </div>
      <div className="card">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{LABEL[b.status] ?? b.status}</span>
        {b.cancel_requested && b.status !== "cancelled" && <span className="ml-2 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-600">Cancellation requested — awaiting Vista</span>}
        <p className="mt-2 text-sm text-slate-500">This booking is confirmed and can no longer be edited here. Request a cancellation above, or contact Vista Group for changes.</p>
      </div>

      <section className="card">
        <h2 className="mb-3 font-semibold text-slate-700">Booking Details</h2>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-slate-400">Haji / Passenger</div>{b.passenger_name ?? "—"}</div>
          <div><div className="text-xs text-slate-400">Mobile</div>{b.mobile ?? "—"}</div>
          <div><div className="text-xs text-slate-400">WhatsApp</div>{b.whatsapp ?? "—"}</div>
          <div><div className="text-xs text-slate-400">Passengers</div>{b.pax ?? "—"}</div>
          <div><div className="text-xs text-slate-400">Type</div><span className="capitalize">{b.booking_type ?? "—"}</span></div>
          <div><div className="text-xs text-slate-400">Booking Date</div>{b.booking_date ?? "—"}</div>
          <div><div className="text-xs text-slate-400">Nusuk Group</div>{b.nusuk_group_no ?? "—"}</div>
          <div><div className="text-xs text-slate-400">Nationality</div>{b.nationality ?? "—"}</div>
          <div><div className="text-xs text-slate-400">Total</div><b>{Number(b.total_amount).toFixed(2)} {b.currency}</b></div>
        </div>
        {b.remarks && <p className="mt-3 text-sm text-slate-500">📝 {b.remarks}</p>}
      </section>

      <section className="card p-0">
        <h2 className="px-4 pt-4 font-semibold text-slate-700">Trips</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="th">#</th><th className="th">Route</th><th className="th">Date</th><th className="th">Time</th>
              <th className="th">Vehicle</th><th className="th">Pickup</th><th className="th">Drop-off</th><th className="th">Flight</th>
            </tr></thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="td">{t.seq}</td>
                  <td className="td">{t.route_id ? rName.get(t.route_id) ?? "—" : t.route_label ?? "—"}</td>
                  <td className="td">{t.trip_date ?? "—"}</td>
                  <td className="td">{fmtTime12(t.trip_time) || "—"}</td>
                  <td className="td">{t.vehicle_id ? vName.get(t.vehicle_id) ?? "—" : "—"}</td>
                  <td className="td">{t.pickup_location ?? "—"}</td>
                  <td className="td">{t.drop_location ?? "—"}</td>
                  <td className="td">{t.flight_no ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
