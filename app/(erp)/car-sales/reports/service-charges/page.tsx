import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import ServiceChargeTable from "./ServiceChargeTable";
import { todaySA } from "@/lib/saudiTime";

export const dynamic = "force-dynamic";

export default async function ServiceChargeReport() {
  await guardStaffPage("carsales.reports");
  const supabase = createClient();
  const { data } = await supabase.from("car_service_charges")
    .select("amount, paid_amount, due_date, vehicle:vehicle_id(id, make, model, model_year, plate_no, vehicle_no, ownership), customer:customer_id(name)")
    .limit(20000);
  const today = todaySA();

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

  return (
    <div>
      <PageHeader title="Monthly Service Charges — by Vehicle"><PrintButton /></PageHeader>
      <ServiceChargeTable rows={rows} />
    </div>
  );
}
