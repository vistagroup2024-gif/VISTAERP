import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import MultiLevelMovement from "@/components/inventory/MultiLevelMovement";

export const dynamic = "force-dynamic";

export default async function MultiLevelMovementPage() {
  await guardStaffPage("accounting.view");
  return (
    <div>
      <PageHeader title="Multi-level Stock Movement Report"
        subtitle="The stock statement drawn on the product-group tree — every group totals what sits beneath it." />
      <MultiLevelMovement />
    </div>
  );
}
