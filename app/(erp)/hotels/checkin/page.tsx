import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { HOTEL_STATUS_LABEL, HCN_STAGE_LABEL, HCN_STAGE_TONE, aggregateHcnStage } from "../lib";
import CheckinActions from "./CheckinActions";

export const dynamic = "force-dynamic";

// Check-in / Upcoming Arrivals grouped by Today / Tomorrow / Next 7 Days / Future.
export default async function CheckinPage() {
  await guardStaffPage("hotels.bookings");
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("hotel_bookings")
    .select("id, booking_no, guest_name, group_no, guests, city, hotel_name, check_in, check_out, rooms, status, checked_in_at, hotels:hotel_id(name), hotel_purchase_bookings(id, hcn_status, hcn, hotel_name, check_in, check_out, sort, supplier:supplier_id(name), hotels:hotel_id(name))")
    .neq("status", "cancelled").gte("check_in", today).order("check_in").limit(1000);

  const rows = (data ?? []).map((b: any) => {
    const purch = ((b.hotel_purchase_bookings ?? []) as any[]).slice().sort((a, c) => (a.sort ?? 0) - (c.sort ?? 0));
    const stage = aggregateHcnStage(purch.map((p) => p.hcn_status).filter(Boolean));
    const hcnNos = Array.from(new Set(purch.map((p) => p.hcn).filter(Boolean)));
    const suppliers = Array.from(new Set(purch.map((p) => p.supplier?.name).filter(Boolean)));
    const stays = purch.map((p) => ({
      id: p.id, hcn_status: p.hcn_status ?? "pending", hcn: p.hcn ?? null,
      hotel: p.hotels?.name ?? p.hotel_name ?? null, check_in: p.check_in, check_out: p.check_out,
    }));
    return { ...b, stage, hcn: hcnNos.join(", "), supplier: suppliers.length > 1 ? `${suppliers[0]} +${suppliers.length - 1}` : (suppliers[0] ?? null), stays };
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
            <table className="w-full min-w-[1040px]">
              <thead className="bg-slate-50"><tr>
                <th className="th">Booking</th><th className="th">Guest / Group</th><th className="th">Hotel / City</th>
                <th className="th">Supplier</th><th className="th">Check-in</th><th className="th">Check-out</th><th className="th">Rooms</th>
                <th className="th">HCN</th><th className="th">Status</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {list.map((r: any) => {
                  // HCN sent -> whole row green; HCN not received & arriving today/tomorrow -> red.
                  const rowTone = r.stage === "sent" ? "bg-green-50" : (r.stage === "pending" && dayDiff(r.check_in) <= 1 ? "bg-red-50" : "");
                  return (
                    <tr key={r.id} className={`border-t border-slate-100 ${rowTone}`}>
                      <td className="td"><Link href={`/hotels/bookings/${r.id}`} className="font-medium text-brand hover:underline">{r.booking_no}</Link></td>
                      <td className="td">{r.guest_name}{r.group_no ? <div className="text-xs text-slate-400">{r.group_no}</div> : null}</td>
                      <td className="td capitalize">{r.hotels?.name ?? r.hotel_name ?? "—"}<div className="text-xs text-slate-400">{r.city}</div></td>
                      <td className="td">{r.supplier ?? "—"}</td>
                      <td className="td">{dateStr(r.check_in)}</td>
                      <td className="td">{dateStr(r.check_out)}</td>
                      <td className="td">{r.rooms}</td>
                      <td className="td font-mono text-xs">{r.hcn || <span className="text-slate-400">—</span>}</td>
                      <td className="td"><span className={`badge ${HCN_STAGE_TONE[r.stage] ?? "bg-slate-100"}`}>{HCN_STAGE_LABEL[r.stage] ?? r.stage}</span><div className="mt-0.5 text-[11px] text-slate-400">{HOTEL_STATUS_LABEL[r.status] ?? ""}</div></td>
                      <td className="td text-right"><CheckinActions booking={{ id: r.id, guest_name: r.guest_name, booking_no: r.booking_no, group_no: r.group_no, guests: r.guests }} stays={r.stays} /></td>
                    </tr>
                  );
                })}
                {list.length === 0 && <tr><td className="td text-slate-400" colSpan={10}>None.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
