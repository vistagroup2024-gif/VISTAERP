import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import ContractForm from "../ContractForm";
import { vehicleTitle } from "../../lib";

export const dynamic = "force-dynamic";

export default async function NewContractPage() {
  await guardStaffPage("carsales.installments");
  const supabase = createClient();
  const [{ data: customers }, { data: vehicles }] = await Promise.all([
    supabase.from("parties").select("id, name").eq("party_type", "customer").eq("is_active", true).order("name"),
    supabase.from("car_vehicles").select("id, vehicle_no, make, model, variant, model_year, plate_no").eq("status", "in_stock").order("created_at", { ascending: false }),
  ]);
  const vOpts = (vehicles ?? []).map((v: any) => ({ id: v.id, label: `${vehicleTitle(v)} · ${v.plate_no ?? v.vehicle_no}` }));
  return (
    <div>
      <PageHeader title="New Installment Contract" />
      <ContractForm existing={null} installments={[]} customers={(customers ?? []) as any} vehicles={vOpts} />
    </div>
  );
}
