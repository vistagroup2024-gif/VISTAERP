import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import ContractDetail from "./ContractDetail";

export const dynamic = "force-dynamic";

export default async function ContractDetailPage({ params }: { params: { id: string } }) {
  const access = await guardStaffPage(["carsales.installments", "carsales.sales"]);
  const supabase = createClient();
  const [{ data: c }, { data: installments }, { data: receipts }] = await Promise.all([
    supabase.from("car_contracts")
      .select("*, customer:customer_id(name, phone, tax_number), vehicle:vehicle_id(vehicle_no, make, model, variant, model_year, plate_no, vin)")
      .eq("id", params.id).single(),
    supabase.from("car_installments").select("*").eq("contract_id", params.id).order("inst_no"),
    supabase.from("car_receipts").select("*, car_receipt_allocations(installment_id, amount, target_type)").eq("contract_id", params.id).order("receipt_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  if (!c) notFound();

  return (
    <div className="max-w-5xl">
      <PageHeader title={`Contract ${c.contract_no}`} />
      <ContractDetail
        contract={{ ...c, customer_name: (c as any).customer?.name ?? null, customer_phone: (c as any).customer?.phone ?? null, vehicle: (c as any).vehicle }}
        installments={(installments ?? []) as any}
        receipts={(receipts ?? []) as any}
        canManage={staffCan(access, "carsales.installments")}
        canReceipts={staffCan(access, "carsales.receipts")}
        canCost={staffCan(access, "carsales.cost")}
      />
    </div>
  );
}
