import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  held: "bg-amber-100 text-amber-700",
  confirmed: "bg-blue-100 text-blue-700",
  traveled: "bg-indigo-100 text-indigo-700",
  closed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export default async function BookingsPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("bookings")
    .select("id, booking_no, status, travel_date, pax_count, total_sell, sell_currency, parties:customer_id(name), packages:package_id(name)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader title="Bookings" action={{ href: "/bookings/new", label: "+ New Booking" }} />
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Booking #</th>
              <th className="th">Customer</th>
              <th className="th">Package</th>
              <th className="th">Travel</th>
              <th className="th text-center">Pax</th>
              <th className="th text-right">Total</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td font-medium">
                  <Link href={`/bookings/${r.id}`} className="text-brand hover:underline">{r.booking_no}</Link>
                </td>
                <td className="td">{r.parties?.name ?? "—"}</td>
                <td className="td">{r.packages?.name ?? "—"}</td>
                <td className="td">{dateStr(r.travel_date)}</td>
                <td className="td text-center">{r.pax_count}</td>
                <td className="td text-right">{money(r.total_sell, r.sell_currency)}</td>
                <td className="td"><span className={`badge ${STATUS_COLOR[r.status]}`}>{r.status}</span></td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={7}>No bookings yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
