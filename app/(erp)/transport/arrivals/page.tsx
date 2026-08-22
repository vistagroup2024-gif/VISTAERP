import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { getStaffAccess, staffCan } from "@/lib/staffSession";
import { dateStr } from "@/lib/format";
import ArrivalActions from "./ArrivalActions";

export const dynamic = "force-dynamic";

// Arrival Service inside Transport: every arriving Visa Group must be handled by a
// Transport booking or a Tafweej. This lists the still-pending arrivals so the
// transport team can act (create a booking or mark Tafweej) without leaving Transport.
export default async function TransportArrivalsPage({ searchParams }: { searchParams: { days?: string } }) {
  const access = await getStaffAccess();
  if (!staffCan(access, "transport.operations") && !staffCan(access, "transport.bookings")) {
    return <div className="card m-6 text-slate-500">You don’t have permission to view Arrival Services.</div>;
  }
  const sb = createClient();
  // Default view is today & tomorrow (p_days = 1 → current_date .. current_date+1).
  const days = Math.max(1, Math.min(365, Number(searchParams.days) || 1));
  const { data, error } = await sb.rpc("arrival_compliance", { p_days: days });
  const rows: any[] = (data as any[]) ?? [];

  const ranges: [number, string][] = [[1, "Today & Tomorrow"], [7, "7 days"], [30, "30 days"], [60, "60 days"]];

  return (
    <div className="max-w-[1200px]">
      <PageHeader title="Arrival Service" />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Arriving within:</span>
        {ranges.map(([d, lbl]) => (
          <Link key={d} href={`/transport/arrivals?days=${d}`}
            className={`rounded-full px-3 py-1 ${days === d ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{lbl}</Link>
        ))}
        <span className={`ml-auto rounded-full px-3 py-1 font-medium ${rows.length ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
          {rows.length ? `${rows.length} pending` : "All handled ✓"}
        </span>
      </div>

      {error && <div className="card text-red-600">{error.message}</div>}

      <div className="card">
        <p className="mb-2 text-xs text-slate-500">
          Every arriving group must be handled by Transport (a booking) or Tafweej. A row clears automatically once a
          transport booking with the group’s Nusuk number exists, or Tafweej is marked.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-green-700">✓ Every upcoming arrival has a Transport booking or Tafweej.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="th">Group</th><th className="th">Group Name</th><th className="th">Agency</th><th className="th">Arrival</th>
                <th className="th">Pax</th><th className="th">Choice</th><th className="th text-right">Action</th>
              </tr></thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id} className="border-b border-slate-50 align-middle">
                    <td className="td font-medium"><Link href={`/groups/${g.id}`} className="text-brand hover:underline">{g.group_no ?? "—"}</Link></td>
                    <td className="td">{g.group_name ?? "—"}</td>
                    <td className="td">{g.agency ?? "—"}</td>
                    <td className="td whitespace-nowrap">{dateStr(g.arrival_date)}{typeof g.days_to_arrival === "number" ? ` (${g.days_to_arrival}d)` : ""}</td>
                    <td className="td">{g.pax ?? "—"}</td>
                    <td className="td">{g.arrival_service ? <span className="capitalize text-slate-600">{g.arrival_service}</span> : <span className="text-slate-400">not chosen</span>}</td>
                    <td className="td"><ArrivalActions groupId={g.id} groupNo={g.group_no} pax={g.pax} choice={g.arrival_service} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
