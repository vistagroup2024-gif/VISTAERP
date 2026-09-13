import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { getStaffAccess, staffCan } from "@/lib/staffSession";
import { dateStr, fmtTime12 } from "@/lib/format";
import ArrivalActions from "./ArrivalActions";
import TafweejActions from "./TafweejActions";

export const dynamic = "force-dynamic";

// Arrival Service, in two categories — because a pilgrim reaches Vista's
// transport in two different ways, and each needs a different thing from the
// transport team:
//
//   VISA BY VISTA       an umrah group Vista issued the visa for. Vista arranges
//                       the arrival — a transport booking or a tafweej — so the
//                       row waits here until one of those exists. The Visa
//                       Company column is the company the visa went through.
//   TRANSPORT BY VISTA  a booking whose Nusuk number matches NO Vista visa
//                       group: the agent got the visa elsewhere and booked only
//                       the transport. There is no group number and no visa
//                       company to show. The tafweej is the AGENT's to create,
//                       where the visa was issued, so what they need from here
//                       is the driver's details once one is assigned — and the
//                       button gives them exactly the block the tafweej asks for.
//
// Until now only the first category existed on this screen. 339 of the 434
// bookings ever taken are the second kind.
const TABS = [
  { key: "visa", label: "Visa by Vista" },
  { key: "transport", label: "Transport by Vista" },
] as const;

export default async function TransportArrivalsPage({ searchParams }: { searchParams: { days?: string; tab?: string } }) {
  const access = await getStaffAccess();
  if (!staffCan(access, "transport.operations") && !staffCan(access, "transport.bookings")) {
    return <div className="card m-6 text-slate-500">You don’t have permission to view Arrival Services.</div>;
  }
  const sb = createClient();
  const days = Math.max(1, Math.min(365, Number(searchParams.days) || 1));
  const tab = searchParams.tab === "transport" ? "transport" : "visa";

  const [{ data: visaData, error: visaErr }, { data: trData, error: trErr }] = await Promise.all([
    sb.rpc("arrival_compliance", { p_days: days }),
    sb.rpc("arrival_transport_by_vista", { p_days: days }),
  ]);
  const visaRows: any[] = (visaData as any[]) ?? [];
  const trRows: any[] = (trData as any[]) ?? [];
  const counts = { visa: visaRows.length, transport: trRows.length };
  const error = tab === "visa" ? visaErr : trErr;

  const ranges: [number, string][] = [[1, "Today & Tomorrow"], [7, "7 days"], [30, "30 days"], [60, "60 days"]];
  const href = (t: string, d: number) => `/transport/arrivals?tab=${t}&days=${d}`;

  return (
    <div className="max-w-[1200px]">
      <PageHeader title="Arrival Service" />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link key={t.key} href={href(t.key, days)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${t.key === tab ? "border-brand font-semibold text-brand" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t.label}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${counts[t.key] ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{counts[t.key]}</span>
          </Link>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Arriving within:</span>
        {ranges.map(([d, lbl]) => (
          <Link key={d} href={href(tab, d)}
            className={`rounded-full px-3 py-1 ${days === d ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{lbl}</Link>
        ))}
      </div>

      {error && <div className="card text-red-600">{error.message}</div>}

      {tab === "visa" ? (
        <div className="card">
          <p className="mb-2 text-xs text-slate-500">
            Groups whose visa Vista issued. Every one must be handled by Transport (a booking) or Tafweej. A row clears
            automatically once a transport booking with the group’s Nusuk number exists, or Tafweej is marked.
          </p>
          {visaRows.length === 0 ? (
            <p className="text-sm text-green-700">✓ Every upcoming arrival has a Transport booking or Tafweej.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="th">Group</th><th className="th">Group Name</th><th className="th">Agency</th><th className="th">Visa Company</th>
                  <th className="th">Arrival</th><th className="th">Pax</th><th className="th">Choice</th><th className="th text-right">Action</th>
                </tr></thead>
                <tbody>
                  {visaRows.map((g) => (
                    <tr key={g.id} className="border-b border-slate-50 align-middle">
                      <td className="td font-medium"><Link href={`/groups/${g.id}`} className="text-brand hover:underline">{g.group_no ?? "—"}</Link></td>
                      <td className="td">{g.group_name ?? "—"}</td>
                      <td className="td">{g.agency ?? "—"}</td>
                      <td className="td">{g.visa_company ?? <span className="text-slate-400">—</span>}</td>
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
      ) : (
        <div className="card">
          <p className="mb-2 text-xs text-slate-500">
            Arrivals on bookings whose visa was <b>not</b> issued by Vista. The agent creates the Tafweej where the visa was
            issued, using the driver Vista assigns — once a driver is on the trip, <b>Driver Tafweej Details</b> gives the exact
            block to send them, and the agent is notified the moment the day’s assignments are confirmed.
          </p>
          {trRows.length === 0 ? (
            <p className="text-sm text-slate-500">No transport-only arrivals in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="th">Booking</th><th className="th">Passenger</th><th className="th">Agency</th>
                  <th className="th">Arrival</th><th className="th">Flight</th><th className="th">Route</th><th className="th">Pax</th>
                  <th className="th">Driver</th><th className="th text-right">Tafweej</th>
                </tr></thead>
                <tbody>
                  {trRows.map((r) => (
                    <tr key={r.trip_id} className="border-b border-slate-50 align-middle">
                      <td className="td font-medium"><Link href={`/transport/bookings/${r.booking_id}`} className="text-brand hover:underline">{r.booking_no ?? "—"}</Link></td>
                      <td className="td">{r.passenger_name ?? "—"}</td>
                      <td className="td">{r.agency ?? "—"}</td>
                      <td className="td whitespace-nowrap">
                        {dateStr(r.trip_date)}{r.trip_time ? ` · ${fmtTime12(r.trip_time)}` : ""}
                        {typeof r.days_to_arrival === "number" ? <span className="text-slate-400"> ({r.days_to_arrival}d)</span> : null}
                      </td>
                      <td className="td">{r.flight_no ?? "—"}</td>
                      <td className="td">{r.route ?? "—"}</td>
                      <td className="td">{r.pax ?? "—"}</td>
                      <td className="td">
                        {r.driver_name
                          ? <>{r.driver_name}{r.vendor_name ? <span className="text-xs text-slate-400"> · {r.vendor_name}</span> : null}
                              {!r.assignment_confirmed && <span className="ml-1 rounded bg-amber-100 px-1.5 text-[10px] uppercase text-amber-700">not confirmed</span>}</>
                          : <span className="text-amber-700">pending assignment</span>}
                      </td>
                      <td className="td"><TafweejActions tripId={r.trip_id} ready={!!r.tafweej_ready} created={!!r.tafweej_created} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
