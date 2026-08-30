import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import StockBalance from "@/components/accounting/StockBalance";

export const dynamic = "force-dynamic";

export default async function StockBalancePage() {
  await guardStaffPage("accounting.view");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Stock Balance" />
      <StockBalance />
    </div>
  );
}
