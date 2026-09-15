import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CostingModule from "./CostingModule";

export const dynamic = "force-dynamic";

export default async function TransportCostingPage() {
  const sb = createClient();
  const [{ data: vehicles }, { data: routes }] = await Promise.all([
    sb.from("transport_vehicles")
      .select("id, name, category, vehicle_type, seating_capacity, is_active, purchase_price, purchase_date, model_year, expected_life_km, expected_life_years, expected_resale_value, depreciation_enabled, tyre_cost, tyre_life_km, oil_change_cost, oil_change_interval_km, overhead_manual_monthly")
      .eq("is_active", true).order("name"),
    sb.from("transport_routes").select("id, name, from_location, to_location, distance_km").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Transport Costing & Pricing" />
      <p className="text-sm text-slate-500">
        A decision-support tool built entirely from the ERP&apos;s own data — routes, vehicles, drivers, trips and
        expenses. It never invents a number: where the history is not there yet, it says so instead of guessing.
      </p>
      <CostingModule vehicles={(vehicles as any[]) ?? []} routes={(routes as any[]) ?? []} />
    </div>
  );
}
