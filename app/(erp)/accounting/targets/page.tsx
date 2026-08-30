import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TargetsBudget from "@/components/accounting/TargetsBudget";

export const dynamic = "force-dynamic";

export default async function TargetsPage() {
  await guardStaffPage("accounting.view");
  return (
    <div className="max-w-5xl">
      <PageHeader title="Targets & Budget" />
      <TargetsBudget />
    </div>
  );
}
