import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import PayrollRun from "@/components/hr/PayrollRun";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  await guardStaffPage("accounting.view");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Payroll" />
      <PayrollRun />
    </div>
  );
}
