import { createClient } from "@/lib/supabase/server";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import CarStockSummary from "@/components/carsales/CarStockSummary";
import VehiclesTable, { VehicleRow } from "./VehiclesTable";

export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const access = await guardStaffPage(["carsales.view", "carsales.vehicles"]);
  const supabase = createClient();
  const { data } = await supabase
    .from("car_vehicles")
    .select("id, vehicle_no, vin, plate_no, make, model, variant, model_year, color, purchase_date, purchase_cost, purchase_vat, total_cost, status, ownership, current_location, item:product_id(name), supplier:supplier_id(name), customer:current_customer_id(name)")
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows: VehicleRow[] = (data ?? []).map((v: any) => ({
    id: v.id, vehicle_no: v.vehicle_no, vin: v.vin, plate_no: v.plate_no, item: v.item?.name ?? null,
    make: v.make, model: v.model, variant: v.variant, model_year: v.model_year, color: v.color,
    purchase_date: v.purchase_date, total_cost: v.total_cost, status: v.status, ownership: v.ownership,
    location: v.current_location, supplier: v.supplier?.name ?? null, customer: v.customer?.name ?? null,
  }));

  const perms = {
    canManage: staffCan(access, "carsales.vehicles"),
    canCost: staffCan(access, "carsales.cost"),
  };

  return (
    <div>
      <RealtimeRefresh tables={["car_vehicles"]} />
      <PageHeader title="Vehicles / Stock" subtitle="View only — a car enters stock when its Purchase Voucher is posted, and leaves when it is sold or delivered" />
      <CarStockSummary />
      <VehiclesTable rows={rows} perms={perms} />
    </div>
  );
}
