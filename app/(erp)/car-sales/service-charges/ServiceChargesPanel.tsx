import { createClient } from "@/lib/supabase/server";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import ServiceChargesTable, { ChargeRow } from "./ServiceChargesTable";

// The Monthly Service Charges list, as a panel rather than a page, because it is
// drawn in two places now: at its own URL, which still works and is still
// bookmarked, and as a tab of Sales Invoice, which is where it is looked for.
// One component, so the two cannot drift apart.
export default async function ServiceChargesPanel() {
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
    <>
      <RealtimeRefresh tables={["car_service_charges"]} />
      <ServiceChargesTable rows={rows} />
    </>
  );
}
