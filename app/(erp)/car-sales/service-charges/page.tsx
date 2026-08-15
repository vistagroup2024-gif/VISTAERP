import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import ServiceChargesTable, { ChargeRow } from "./ServiceChargesTable";

export const dynamic = "force-dynamic";

export default async function ServiceChargesPage() {
  await guardStaffPage("carsales.charges");
  const supabase = createClient();
  const { data } = await supabase
    .from("car_service_charges")
    .select("id, charge_month, due_date, amount, paid_amount, vehicle:vehicle_id(id, vehicle_no, make, model, model_year, plate_no, ownership), customer:customer_id(name)")
    .order("charge_month", { ascending: false })
    .limit(5000);

  const rows: ChargeRow[] = (data ?? []).map((c: any) => ({
    id: c.id, charge_month: c.charge_month, due_date: c.due_date,
    amount: Number(c.amount || 0), paid: Number(c.paid_amount || 0),
    vehicle_id: c.vehicle?.id ?? null,
    vehicle: [c.vehicle?.make, c.vehicle?.model, c.vehicle?.model_year].filter(Boolean).join(" ") || c.vehicle?.vehicle_no || "—",
    plate: c.vehicle?.plate_no ?? null, ownership: c.vehicle?.ownership ?? "vista",
    customer: c.customer?.name ?? null,
  }));

  return (
    <div>
      <RealtimeRefresh tables={["car_service_charges"]} />
      <PageHeader title="Monthly Service Charges" />
      <ServiceChargesTable rows={rows} />
    </div>
  );
}
