import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import VehicleForm from "../VehicleForm";

export const dynamic = "force-dynamic";

export default async function NewVehiclePage() {
  await guardStaffPage("carsales.vehicles");
  const supabase = createClient();
  const { data: suppliers } = await supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name");
  return (
    <div>
      <PageHeader title="New Vehicle" />
      <VehicleForm existing={null} suppliers={(suppliers ?? []) as any} />
    </div>
  );
}
