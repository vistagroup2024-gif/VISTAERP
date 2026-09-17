import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import StockQuery from "@/components/inventory/StockQuery";

export const dynamic = "force-dynamic";

export default async function StockQueryPage() {
  await guardStaffPage("accounting.view");
  return (
    <div>
      <PageHeader title="Query" />
      <StockQuery />
    </div>
  );
}
