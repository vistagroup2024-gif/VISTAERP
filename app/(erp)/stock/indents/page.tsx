import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import StockIndents from "@/components/inventory/StockIndents";

export const dynamic = "force-dynamic";

export default async function StockIndentsPage() {
  await guardStaffPage("accounting.view");
  return (
    <div>
      <PageHeader title="Raise Indents for Items with Low Stock"
        subtitle="Tick what to replenish and raise the internal requisition a Purchase Order is written from." />
      <StockIndents />
    </div>
  );
}
