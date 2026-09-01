import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import WorkFlowBoard from "@/components/accounting/WorkFlowBoard";

export const dynamic = "force-dynamic";

export default async function WorkFlowPage() {
  await guardStaffPage("accounting.view");
  return (
    <div>
      <PageHeader title="Work Flow"
        subtitle="Each document is loaded from the one before it. Pending is what the next step can still pick up." />
      <WorkFlowBoard />
    </div>
  );
}
