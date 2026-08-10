import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

function Kpi({ label, value, tone, href }: { label: string; value: string | number; tone?: string; href?: string }) {
  const inner = (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function HotelDashboardPage() {
  const access = await guardStaffPage(["hotels.reports", "hotels.bookings"]);
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const [{ data: bookings }, { data: purch }] = await Promise.all([
    supabase.from("hotel_bookings").select("id, status, check_in, check_out, sale_total, hotel_purchase_bookings(hcn_status)"),
    supabase.from("hotel_purchase_bookings").select("purchase_total, hcn_status, bill_id, bills:bill_id(total, amount_paid)"),
  ]);

  const b = bookings ?? [];
  const cnt = (fn: (x: any) => boolean) => b.filter(fn).length;
  const hcnOf = (x: any) => { const h = (x.hotel_purchase_bookings ?? []).map((p: any) => p.hcn_status); return h.includes("shared") || h.includes("received") ? "received" : "pending"; };

  const totalSales = b.filter((x: any) => x.status !== "cancelled").reduce((s: number, x: any) => s + (Number(x.sale_total) || 0), 0);
  const canProfit = staffCan(access, "hotels.profit");
  const totalPurchase = (purch ?? []).reduce((s: number, p: any) => s + (Number(p.purchase_total) || 0), 0);
  const outstanding = (purch ?? []).reduce((s: number, p: any) => s + (p.bills ? (Number(p.bills.total) || 0) - (Number(p.bills.amount_paid) || 0) : 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Hotel Dashboard" />
      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Bookings</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Total" value={b.length} href="/hotels/bookings" />
          <Kpi label="Pending" value={cnt((x) => x.status === "pending")} tone="text-slate-600" />
          <Kpi label="Confirmed" value={cnt((x) => x.status === "confirmed")} tone="text-blue-700" />
          <Kpi label="HCN Pending" value={cnt((x) => x.status !== "cancelled" && x.status !== "completed" && hcnOf(x) === "pending")} tone="text-red-600" href="/hotels/hcn" />
          <Kpi label="HCN Received" value={cnt((x) => hcnOf(x) === "received")} tone="text-indigo-700" />
          <Kpi label="Check-in Today" value={cnt((x) => x.check_in === today && x.status !== "cancelled")} tone="text-amber-700" href="/hotels/checkin" />
          <Kpi label="Check-in Tomorrow" value={cnt((x) => x.check_in === tomorrow && x.status !== "cancelled")} tone="text-amber-700" />
          <Kpi label="Check-out Today" value={cnt((x) => x.check_out === today && x.status !== "cancelled")} tone="text-amber-700" href="/hotels/checkout" />
          <Kpi label="Completed" value={cnt((x) => x.status === "completed")} tone="text-green-700" />
          <Kpi label="Cancelled" value={cnt((x) => x.status === "cancelled")} tone="text-red-600" />
        </div>
      </div>
      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Financial</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Total Sales" value={money(totalSales, "SAR")} tone="text-brand" />
          {canProfit && <Kpi label="Total Purchase" value={money(totalPurchase, "SAR")} />}
          {canProfit && <Kpi label="Gross Profit" value={money(totalSales - totalPurchase, "SAR")} tone="text-green-700" />}
          <Kpi label="Outstanding Payable" value={money(outstanding, "SAR")} tone="text-orange-700" />
        </div>
        {!canProfit && <p className="mt-2 text-xs text-slate-400">Purchase and profit figures are hidden — they require the “View Profit / Margin” permission.</p>}
      </div>
    </div>
  );
}
