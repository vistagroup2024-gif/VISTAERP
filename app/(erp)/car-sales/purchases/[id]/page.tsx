import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PurchaseOrderDetail from "./PurchaseOrderDetail";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderDetailPage({ params }: { params: { id: string } }) {
  const access = await guardStaffPage("carsales.purchase");
  const supabase = createClient();
  const [{ data: po }, { data: items }] = await Promise.all([
    supabase.from("car_purchase_orders").select("*, supplier:supplier_id(name)").eq("id", params.id).single(),
    supabase.from("car_purchase_order_items").select("*, vehicle:vehicle_id(vehicle_no)").eq("po_id", params.id).order("sort").order("created_at"),
  ]);
  if (!po) notFound();
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Purchase Order ${po.po_no}`} />
      <PurchaseOrderDetail po={{ ...po, supplier_name: (po as any).supplier?.name ?? null }} items={(items ?? []) as any} canManage={staffCan(access, "carsales.purchase")} />
    </div>
  );
}
