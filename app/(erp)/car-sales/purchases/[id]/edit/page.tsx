import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PurchaseOrderForm from "../../PurchaseOrderForm";

export const dynamic = "force-dynamic";

export default async function EditPurchaseOrderPage({ params }: { params: { id: string } }) {
  await guardStaffPage("carsales.purchase");
  const supabase = createClient();
  const [{ data: po }, { data: items }, { data: suppliers }] = await Promise.all([
    supabase.from("car_purchase_orders").select("*").eq("id", params.id).single(),
    supabase.from("car_purchase_order_items").select("*").eq("po_id", params.id).order("sort").order("created_at"),
    supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name"),
  ]);
  if (!po) notFound();
  return (
    <div>
      <PageHeader title={`Edit ${po.po_no}`} />
      <PurchaseOrderForm existing={po} items={(items ?? []) as any} suppliers={(suppliers ?? []) as any} />
    </div>
  );
}
