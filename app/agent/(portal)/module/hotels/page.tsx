import Link from "next/link";
import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import { createClient } from "@/lib/supabase/server";
import RealtimeRefresh from "@/components/RealtimeRefresh";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-700", Processing: "bg-blue-100 text-blue-700",
  Confirmed: "bg-indigo-100 text-indigo-700", "HCN Received": "bg-teal-100 text-teal-700",
  Completed: "bg-green-100 text-green-700", Cancelled: "bg-red-100 text-red-700",
};

export default async function AgentHotelList({ searchParams }: { searchParams: { created?: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "hotel.view_own") && !can(agent, "hotel.create")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to Hotels.</div>;
  }
  const sb = createClient();
  const { data } = await sb.rpc("b2b_hotel_my_bookings", { p_token: agent.token });
  const rows: any[] = (data as any[]) ?? [];

  return (
    <div className="max-w-4xl">
      <RealtimeRefresh tables={["hotel_bookings"]} pollMs={20000} />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Hotel Bookings</h1>
        {can(agent, "hotel.create") && <Link href="/agent/module/hotels/new" className="btn">+ New Hotel Booking</Link>}
      </div>
      {searchParams.created && <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">✓ Booking request submitted.</div>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th">Booking #</th><th className="th">Guest / Group</th><th className="th">City / Hotel</th>
            <th className="th">Check-in</th><th className="th">Nights</th><th className="th">HCN</th><th className="th">Status</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="td font-medium"><Link href={`/agent/module/hotels/${r.id}`} className="text-brand hover:underline">{r.booking_no}</Link></td>
                <td className="td">{r.guest_name}{r.group_no ? <div className="text-xs text-slate-400">{r.group_no}</div> : null}</td>
                <td className="td capitalize">{r.city ?? "—"}<div className="text-xs text-slate-400">{r.hotel ?? ""}</div></td>
                <td className="td">{r.check_in ?? "—"}</td>
                <td className="td">{r.nights || "—"}</td>
                <td className="td font-mono">{r.hcn ?? "—"}</td>
                <td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[r.status] ?? "bg-slate-200"}`}>{r.status}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>No hotel bookings yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
