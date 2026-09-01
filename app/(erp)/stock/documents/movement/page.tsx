import { loadPickAccounts } from "@/lib/accounting";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import StockMovement from "@/components/accounting/StockMovement";

export const dynamic = "force-dynamic";

export default async function StockMovementPage() {
  await guardStaffPage("accounting.view");
  const { accounts } = await loadPickAccounts();
  return (
    <div>
      <PageHeader title="Stock Receipt / Issue / Adjustment"
        subtitle="Direct stock entry at moving-average cost, with the matching GL post." />
      <StockMovement counterAccounts={accounts} />
    </div>
  );
}
