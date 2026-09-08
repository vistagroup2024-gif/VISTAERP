import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import ProductCosting from "@/components/accounting/ProductCosting";

export const dynamic = "force-dynamic";

export default async function ProductCostingPage() {
  await guardStaffPage("accounting.view");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Product Costing" />
      <ProductCosting />
    </div>
  );
}
