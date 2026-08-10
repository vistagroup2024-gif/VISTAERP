import { createClient } from "@/lib/supabase/server";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

// Hotel Reports: sales / purchase / profit summarised by city and by agent.
export default async function HotelReportsPage() {
  const access = await guardStaffPage("hotels.reports");
  const supabase = createClient();
  const canProfit = staffCan(access, "hotels.profit");
  const { data } = await supabase
    .from("hotel_bookings")
    .select("city, status, sale_total, parties:agent_id(name), hotel_purchase_bookings(purchase_total)")
    .neq("status", "cancelled").limit(2000);

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
      <h2 className="mb-2 font-semibold text-slate-700">{title}</h2>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[600px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">{keyLabel}</th><th className="th">Bookings</th><th className="th">Sales</th>
            {canProfit && <th className="th">Purchase</th>}{canProfit && <th className="th">Profit</th>}
          </tr></thead>
          <tbody>
            {Array.from(map.entries()).map(([k, v]) => (
              <tr key={k} className="border-t border-slate-100">
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
      <Section title="By City" map={byCity} keyLabel="City" />
      <Section title="By Agent" map={byAgent} keyLabel="Agent" />
    </div>
  );
}
