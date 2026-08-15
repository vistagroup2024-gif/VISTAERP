import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PurchaseOrderForm from "../PurchaseOrderForm";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  await guardStaffPage("carsales.purchase");
  const supabase = createClient();
  const { data: suppliers } = await supabase.from("parties").select("id, name").eq("party_type", "supplier").eq("is_active", true).order("name");
  return (
    <div>
      <PageHeader title="New Purchase Order" />
      <PurchaseOrderForm existing={null} items={[]} suppliers={(suppliers ?? []) as any} />
    </div>
  );
}
