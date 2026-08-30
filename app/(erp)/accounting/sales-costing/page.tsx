import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import SalesCosting from "@/components/accounting/SalesCosting";

export const dynamic = "force-dynamic";

export default async function SalesCostingPage() {
  await guardStaffPage("accounting.view");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Sales Costing" />
      <SalesCosting />
    </div>
  );
}
