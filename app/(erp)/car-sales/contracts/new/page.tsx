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
    // select("*") so is_trading (added by migration 259) is available when
    // present, without breaking before the column exists.
    supabase.from("car_vehicles").select("*").eq("status", "in_stock").order("created_at", { ascending: false }),
  ]);
  const vOpts = (vehicles ?? []).map((v: any) => ({ id: v.id, label: `${vehicleTitle(v)} · ${v.plate_no ?? v.vehicle_no}`, is_trading: !!v.is_trading }));
  return (
    <div>
      <PageHeader title="New Car Invoice" />
      <ContractForm existing={null} installments={[]} customers={(customers ?? []) as any} vehicles={vOpts} />
    </div>
  );
}
