import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { HOTEL_STATUS_LABEL, HOTEL_STATUS_TONE } from "../lib";

export const dynamic = "force-dynamic";

// Check-out / Completed Stays: bookings whose check-out has passed. They become
// eligible for Completed only after the check-out date (enforced in the RPC too).
export default async function CheckoutPage() {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("hotel_bookings")
    .select("id, booking_no, guest_name, city, hotel_name, check_in, check_out, rooms, status, checked_out_at, hotels:hotel_id(name)")
    .neq("status", "cancelled").lte("check_out", today).order("check_out", { ascending: false }).limit(1000);

  const rows = data ?? [];
  const eligible = rows.filter((r: any) => r.status !== "completed");
  const done = rows.filter((r: any) => r.status === "completed");

  const Table = ({ list }: { list: any[] }) => (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[820px]">
        <thead className="bg-slate-50"><tr>
          <th className="th">Booking</th><th className="th">Guest</th><th className="th">Hotel / City</th>
          <th className="th">Check-in</th><th className="th">Check-out</th><th className="th">Rooms</th><th className="th">Status</th>
        </tr></thead>
        <tbody>
          {list.map((r: any) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="td"><Link href={`/hotels/bookings/${r.id}`} className="font-medium text-brand hover:underline">{r.booking_no}</Link></td>
              <td className="td">{r.guest_name}</td>
              <td className="td capitalize">{r.hotels?.name ?? r.hotel_name ?? "—"}<div className="text-xs text-slate-400">{r.city}</div></td>
              <td className="td">{dateStr(r.check_in)}</td>
              <td className="td">{dateStr(r.check_out)}</td>
              <td className="td">{r.rooms}</td>
              <td className="td"><span className={`badge ${HOTEL_STATUS_TONE[r.status]}`}>{HOTEL_STATUS_LABEL[r.status]}</span></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td className="td text-slate-400" colSpan={7}>None.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Check-out / Completed Stays" />
      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Eligible for Completion <span className="text-sm text-slate-400">({eligible.length})</span></h2>
        <p className="mb-2 text-xs text-slate-500">Check-out date has passed. Open a booking and “Mark Check-out” to complete it.</p>
        <Table list={eligible} />
      </div>
      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Completed <span className="text-sm text-slate-400">({done.length})</span></h2>
        <Table list={done} />
      </div>
    </div>
  );
}
