import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { HOTEL_STATUS_LABEL, HOTEL_STATUS_TONE } from "../lib";

export const dynamic = "force-dynamic";

// Check-in / Upcoming Arrivals grouped by Today / Tomorrow / Next 7 Days / Future.
export default async function CheckinPage() {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("hotel_bookings")
    .select("id, booking_no, guest_name, group_no, city, hotel_name, check_in, check_out, rooms, status, checked_in_at, hotels:hotel_id(name), hotel_purchase_bookings(hcn_status)")
    .neq("status", "cancelled").gte("check_in", today).order("check_in").limit(1000);

  const rows = (data ?? []).map((b: any) => {
    const hcn = (b.hotel_purchase_bookings ?? []).map((p: any) => p.hcn_status);
    return { ...b, hcnStatus: hcn.includes("shared") ? "shared" : hcn.includes("received") ? "received" : "pending" };
  });
  const dayDiff = (d: string) => Math.round((new Date(d + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000);
  const groups: [string, any[]][] = [
    ["Today", rows.filter((r: any) => dayDiff(r.check_in) === 0)],
    ["Tomorrow", rows.filter((r: any) => dayDiff(r.check_in) === 1)],
    ["Next 7 Days", rows.filter((r: any) => { const d = dayDiff(r.check_in); return d >= 2 && d <= 7; })],
    ["Future", rows.filter((r: any) => dayDiff(r.check_in) > 7)],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Check-in / Upcoming Arrivals" />
      {groups.map(([title, list]) => (
        <div key={title}>
          <h2 className="mb-2 font-semibold text-slate-700">{title} <span className="text-sm text-slate-400">({list.length})</span></h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[900px]">
              <thead className="bg-slate-50"><tr>
                <th className="th">Booking</th><th className="th">Guest / Group</th><th className="th">Hotel / City</th>
                <th className="th">Check-in</th><th className="th">Check-out</th><th className="th">Rooms</th><th className="th">HCN</th><th className="th">Status</th>
              </tr></thead>
              <tbody>
                {list.map((r: any) => (
                  <tr key={r.id} className={`border-t border-slate-100 ${r.hcnStatus === "pending" && dayDiff(r.check_in) <= 2 ? "bg-red-50" : ""}`}>
                    <td className="td"><Link href={`/hotels/bookings/${r.id}`} className="font-medium text-brand hover:underline">{r.booking_no}</Link></td>
                    <td className="td">{r.guest_name}{r.group_no ? <div className="text-xs text-slate-400">{r.group_no}</div> : null}</td>
                    <td className="td capitalize">{r.hotels?.name ?? r.hotel_name ?? "—"}<div className="text-xs text-slate-400">{r.city}</div></td>
                    <td className="td">{dateStr(r.check_in)}</td>
                    <td className="td">{dateStr(r.check_out)}</td>
                    <td className="td">{r.rooms}</td>
                    <td className="td"><span className={`badge ${r.hcnStatus === "pending" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{r.hcnStatus}</span></td>
                    <td className="td"><span className={`badge ${HOTEL_STATUS_TONE[r.status]}`}>{HOTEL_STATUS_LABEL[r.status]}</span></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>None.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
