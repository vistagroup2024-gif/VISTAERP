import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import VehicleForm from "../VehicleForm";

export const dynamic = "force-dynamic";

export default async function NewVehiclePage() {
  await guardStaffPage("carsales.vehicles");
  const supabase = createClient();
  const { data: suppliers } = await supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name");
  const { data: products } = await supabase.from("acct_products").select("id, name, parent:parent_id(name)").eq("is_active", true).eq("is_group", false).order("name");
  return (
    <div>
      <PageHeader title="New Vehicle" />
      <VehicleForm existing={null} suppliers={(suppliers ?? []) as any}
        products={((products ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, group: p.parent?.name ?? null }))} />
    </div>
  );
}
