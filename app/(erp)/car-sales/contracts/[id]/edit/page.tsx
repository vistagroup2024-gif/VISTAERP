import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import ContractForm from "../../ContractForm";
import { vehicleTitle } from "../../../lib";

export const dynamic = "force-dynamic";

export default async function EditContractPage({ params }: { params: { id: string } }) {
  await guardStaffPage("carsales.installments");
  const supabase = createClient();
  const { data: c } = await supabase.from("car_contracts").select("*").eq("id", params.id).single();
  if (!c) notFound();
  if (c.status !== "draft") notFound();

  const [{ data: installments }, { data: customers }, { data: vehicles }] = await Promise.all([
    supabase.from("car_installments").select("*").eq("contract_id", params.id).order("inst_no"),
    supabase.from("parties").select("id, name").eq("party_type", "customer").eq("is_active", true).order("name"),
    supabase.from("car_vehicles").select("id, vehicle_no, make, model, variant, model_year, plate_no, item:product_id(name)").or(`status.eq.in_stock,id.eq.${c.vehicle_id}`).order("created_at", { ascending: false }),
  ]);
  const vOpts = (vehicles ?? []).map((v: any) => ({ id: v.id, label: `${vehicleTitle({ ...v, item: v.item?.name })} · ${v.plate_no ?? v.vehicle_no}` }));
  return (
    <div>
      <PageHeader title={`Edit ${c.contract_no}`} />
      <ContractForm existing={c} installments={(installments ?? []) as any} customers={(customers ?? []) as any} vehicles={vOpts} />
    </div>
  );
}
