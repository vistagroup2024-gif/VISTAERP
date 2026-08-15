import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import VehicleForm from "../../VehicleForm";

export const dynamic = "force-dynamic";

export default async function EditVehiclePage({ params }: { params: { id: string } }) {
  await guardStaffPage("carsales.vehicles");
  const supabase = createClient();
  const [{ data: v }, { data: suppliers }] = await Promise.all([
    supabase.from("car_vehicles").select("*").eq("id", params.id).single(),
    supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name"),
  ]);
  if (!v) notFound();
  return (
    <div>
      <PageHeader title={`Edit ${v.vehicle_no}`} />
      <VehicleForm existing={v} suppliers={(suppliers ?? []) as any} />
    </div>
  );
}
