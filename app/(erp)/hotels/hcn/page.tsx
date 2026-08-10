import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { VENDOR_STATUS_LABEL, HCN_STATUS_LABEL } from "../lib";

export const dynamic = "force-dynamic";

// HCN Management: every purchase booking with its HCN state, ordered by the
// nearest check-in so pending confirmations bubble up. Flags pre-check-in risk.
export default async function HcnManagementPage() {
  await guardStaffPage(["hotels.hcn", "hotels.bookings"]);
  const supabase = createClient();
  const { data } = await supabase
    .from("hotel_purchase_bookings")
    .select("id, vendor_status, hcn, hcn_status, hcn_received_date, hcn_shared, booking_id, hotel_bookings:booking_id(booking_no, guest_name, city, check_in, status, hotel_name, hotels:hotel_id(name))")
    .order("created_at", { ascending: false })
    .limit(1000);

  const rows = (data ?? [])
    .map((p: any) => ({ ...p, b: p.hotel_bookings }))
    .filter((p: any) => p.b && p.b.status !== "cancelled")
    .sort((a: any, b: any) => (a.b.check_in ?? "9999").localeCompare(b.b.check_in ?? "9999"));

  const today = new Date().toISOString().slice(0, 10);
  const risk = (ci: string | null, hcnStatus: string) => {
    if (!ci || hcnStatus === "received" || hcnStatus === "shared") return "";
    const days = Math.round((new Date(ci + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000);
    if (days <= 0) return "bg-red-500 text-white";
    if (days === 1) return "bg-red-100 text-red-700";
    if (days === 2) return "bg-amber-100 text-amber-800";
    return "";
  };

  return (
    <div>
      <PageHeader title="HCN Management" />
      <p className="mb-3 text-sm text-slate-500">Confirmation numbers per vendor booking. Rows highlight when check-in is near and the HCN is still pending.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Booking</th><th className="th">Guest</th><th className="th">Hotel / City</th>
            <th className="th">Check-in</th><th className="th">Vendor Status</th><th className="th">HCN</th><th className="th">HCN Status</th><th className="th"></th>
          </tr></thead>
          <tbody>
            {rows.map((p: any) => (
              <tr key={p.id} className={`border-t border-slate-100 ${risk(p.b.check_in, p.hcn_status)}`}>
                <td className="td"><Link href={`/hotels/bookings/${p.booking_id}`} className="font-medium text-brand hover:underline">{p.b.booking_no}</Link></td>
                <td className="td">{p.b.guest_name}</td>
                <td className="td capitalize">{p.b.hotels?.name ?? p.b.hotel_name ?? "—"}<div className="text-xs opacity-70">{p.b.city}</div></td>
                <td className="td">{dateStr(p.b.check_in)}</td>
                <td className="td">{VENDOR_STATUS_LABEL[p.vendor_status] ?? p.vendor_status}</td>
                <td className="td font-mono">{p.hcn ?? "—"}</td>
                <td className="td">{HCN_STATUS_LABEL[p.hcn_status] ?? p.hcn_status}{p.hcn_shared ? " ✓" : ""}</td>
                <td className="td"><Link href={`/hotels/bookings/${p.booking_id}`} className="text-sm text-brand hover:underline">Open →</Link></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No purchase bookings yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
