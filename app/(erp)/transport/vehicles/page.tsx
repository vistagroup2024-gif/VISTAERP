import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import VehicleManager from "./VehicleManager";

export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("transport_vehicles")
    .select("id, category, name, seating_capacity, luggage_capacity, upgrade_rank, image, is_active, sort_order, created_at")
    .order("sort_order")
    .order("name");

  return (
    <div className="max-w-5xl">
      <PageHeader title="Vehicles" />
      <p className="mb-4 text-sm text-slate-500">
        Fleet master used across route rates, packages, drivers and bookings. Set a vehicle
        <b> Inactive</b> to hide it from new bookings without deleting history.
      </p>
      <VehicleManager initial={(rows as any[]) ?? []} />
    </div>
  );
}
