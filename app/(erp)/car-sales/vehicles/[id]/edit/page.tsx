import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { productOptions } from "@/components/accounting/ProductPicker";
import VehicleForm from "../../VehicleForm";

export const dynamic = "force-dynamic";

export default async function EditVehiclePage({ params }: { params: { id: string } }) {
  await guardStaffPage("carsales.vehicles");
  const supabase = createClient();
  const [{ data: v }, { data: suppliers }, { data: products }] = await Promise.all([
    supabase.from("car_vehicles").select("*, item:product_id(name)").eq("id", params.id).single(),
    supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name"),
    supabase.from("acct_products").select("id, name, parent_id, is_group").eq("is_active", true).order("name"),
  ]);
  if (!v) notFound();
  return (
    <div>
      <PageHeader title={`Edit ${v.vehicle_no}`} />
      <VehicleForm existing={v} suppliers={(suppliers ?? []) as any}
        products={productOptions((products ?? []) as any[])} />
    </div>
  );
}
