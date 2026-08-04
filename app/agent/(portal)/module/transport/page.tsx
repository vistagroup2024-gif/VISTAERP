import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import RealtimeRefresh from "@/components/RealtimeRefresh";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  draft: "Draft", pending: "Pending", confirmed: "Confirmed", assigned: "Assigned",
  on_route: "On Route", picked_up: "Picked Up", completed: "Completed", cancelled: "Cancelled",
};
const COLOR: Record<string, string> = {
  draft: "bg-slate-200 text-slate-600", pending: "bg-amber-100 text-amber-700", confirmed: "bg-blue-100 text-blue-700",
  assigned: "bg-indigo-100 text-indigo-700", on_route: "bg-cyan-100 text-cyan-700", picked_up: "bg-teal-100 text-teal-700",
  completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
};

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
    <div className="max-w-4xl">
      <RealtimeRefresh tables={["transport_bookings"]} pollMs={20000} />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Transport Bookings</h1>
        <div className="flex gap-2">
          <Link href="/agent/module/transport/schedule" className="btn-outline">📅 Schedule</Link>
          {can(agent, "transport.request") && <Link href="/agent/module/transport/new" className="btn">+ New Booking</Link>}
        </div>
      </div>
      {searchParams.created && (
        <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">✓ Booking created successfully.</div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr><th className="th">Booking #</th><th className="th">Passenger</th><th className="th">Type</th><th className="th">Date</th><th className="th">Total</th><th className="th">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td font-medium"><Link href={`/agent/module/transport/${r.id}`} className="text-brand hover:underline">{r.booking_no ?? "—"}</Link></td>
                <td className="td">{r.passenger_name ?? "—"}</td>
                <td className="td">{r.booking_type}</td>
                <td className="td">{r.booking_date ?? "—"}</td>
                <td className="td">{Number(r.total_amount).toFixed(2)} {r.currency}</td>
                <td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[r.status] ?? "bg-slate-200"}`}>{LABEL[r.status] ?? r.status}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No transport bookings yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
