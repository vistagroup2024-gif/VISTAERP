import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import { sar, OWNERSHIP_LABEL, vehicleTitle } from "../../lib";

export const dynamic = "force-dynamic";

export default async function ServiceChargeReport() {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const { data } = await supabase.from("car_service_charges")
    .select("amount, paid_amount, due_date, vehicle:vehicle_id(id, make, model, model_year, plate_no, vehicle_no, ownership), customer:customer_id(name)")
    .limit(20000);
  const today = new Date().toISOString().slice(0, 10);

  const byV = new Map<string, any>();
  for (const c of (data ?? []) as any[]) {
    const v = c.vehicle; if (!v) continue;
    const k = v.id;
    const cur = byV.get(k) ?? { vehicle: v, customer: c.customer?.name ?? "—", charged: 0, paid: 0, outstanding: 0, overdue: 0, months: 0 };
    const rem = Math.max(0, Number(c.amount || 0) - Number(c.paid_amount || 0));
    cur.charged += Number(c.amount || 0); cur.paid += Number(c.paid_amount || 0); cur.outstanding += rem; cur.months += 1;
    if (c.due_date < today) cur.overdue += rem;
    byV.set(k, cur);
  }
  const rows = Array.from(byV.values()).sort((a, b) => b.outstanding - a.outstanding);
  const t = rows.reduce((a, r) => ({ charged: a.charged + r.charged, paid: a.paid + r.paid, outstanding: a.outstanding + r.outstanding, overdue: a.overdue + r.overdue }), { charged: 0, paid: 0, outstanding: 0, overdue: 0 });

  return (
    <div>
      <PageHeader title="Monthly Service Charges — by Vehicle"><PrintButton /></PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Vehicle</th><th className="th">Customer</th><th className="th">Ownership</th><th className="th text-right">Months</th>
            <th className="th text-right">Charged</th><th className="th text-right">Paid</th><th className="th text-right">Outstanding</th><th className="th text-right">Overdue</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="td"><Link href={`/car-sales/vehicles/${r.vehicle.id}`} className="text-brand hover:underline">{vehicleTitle(r.vehicle)}</Link><div className="text-xs text-slate-400">{r.vehicle.plate_no ?? ""}</div></td>
                <td className="td">{r.customer}</td>
                <td className="td">{OWNERSHIP_LABEL[r.vehicle.ownership] ?? r.vehicle.ownership}</td>
                <td className="td text-right">{r.months}</td>
                <td className="td text-right tabular-nums">{sar(r.charged)}</td>
                <td className="td text-right tabular-nums">{sar(r.paid)}</td>
                <td className="td text-right tabular-nums font-medium">{sar(r.outstanding)}</td>
                <td className="td text-right tabular-nums text-red-600">{sar(r.overdue)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={8}>No charges yet.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold">
            <td className="td" colSpan={4}>Total ({rows.length} vehicles)</td>
            <td className="td text-right tabular-nums">{sar(t.charged)}</td><td className="td text-right tabular-nums">{sar(t.paid)}</td>
            <td className="td text-right tabular-nums">{sar(t.outstanding)}</td><td className="td text-right tabular-nums">{sar(t.overdue)}</td>
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
