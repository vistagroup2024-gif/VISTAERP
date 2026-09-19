import { createClient } from "@/lib/supabase/server";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import SectionHeader from "@/components/reports/SectionHeader";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

// Hotel Reports: sales / purchase / profit summarised by city and by agent.
export default async function HotelReportsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const access = await guardStaffPage("hotels.reports");
  const supabase = createClient();
  const canProfit = staffCan(access, "hotels.profit");
  const from = searchParams.from || "";
  const to = searchParams.to || "";
  let query = supabase
    .from("hotel_bookings")
    .select("city, status, booking_date, sale_total, parties:agent_id(name), hotel_purchase_bookings(purchase_total)")
    .neq("status", "cancelled").limit(2000);
  if (from) query = query.gte("booking_date", from);
  if (to) query = query.lte("booking_date", to);
  const { data } = await query;

  const byCity = new Map<string, { sales: number; purchase: number; count: number }>();
  const byAgent = new Map<string, { sales: number; purchase: number; count: number }>();
  (data ?? []).forEach((b: any) => {
    const purchase = (b.hotel_purchase_bookings ?? []).reduce((s: number, p: any) => s + (Number(p.purchase_total) || 0), 0);
    const sale = Number(b.sale_total) || 0;
    const c = b.city ?? "—"; const a = b.parties?.name ?? "Direct";
    const cc = byCity.get(c) ?? { sales: 0, purchase: 0, count: 0 }; cc.sales += sale; cc.purchase += purchase; cc.count += 1; byCity.set(c, cc);
    const aa = byAgent.get(a) ?? { sales: 0, purchase: 0, count: 0 }; aa.sales += sale; aa.purchase += purchase; aa.count += 1; byAgent.set(a, aa);
  });

  const Section = ({ title, map, keyLabel }: { title: string; map: Map<string, any>; keyLabel: string }) => (
    <div>
      <SectionHeader title={title} />
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full min-w-[600px]">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr>
            <th className="px-4 py-2.5 text-left"><span className="col-resize">{keyLabel}</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Bookings</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Sales</span></th>
            {canProfit && <th className="px-4 py-2.5 text-left"><span className="col-resize">Purchase</span></th>}{canProfit && <th className="px-4 py-2.5 text-left"><span className="col-resize">Profit</span></th>}
          </tr></thead>
          <tbody>
            {Array.from(map.entries()).map(([k, v], i) => (
              <tr key={k} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
                <td className="td font-medium capitalize">{k}</td>
                <td className="td">{v.count}</td>
                <td className="td">{money(v.sales, "SAR")}</td>
                {canProfit && <td className="td">{money(v.purchase, "SAR")}</td>}
                {canProfit && <td className="td text-green-700">{money(v.sales - v.purchase, "SAR")}</td>}
              </tr>
            ))}
            {map.size === 0 && <tr><td className="td text-slate-400" colSpan={5}>No data.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Hotel Reports" />
      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">Booking Date From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">Booking Date To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
        {(from || to) && <a href="/hotels/reports" className="text-sm text-slate-400 hover:underline">Clear</a>}
      </form>
      <Section title="By City" map={byCity} keyLabel="City" />
      <Section title="By Agent" map={byAgent} keyLabel="Agent" />
    </div>
  );
}
