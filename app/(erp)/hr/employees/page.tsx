import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import EmployeeManager from "@/components/hr/EmployeeManager";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("employees")
    .select("id, emp_code, name, department, designation, join_date, basic_salary, allowances, deductions, bank_name, bank_account, iqama_no, iqama_expiry, status")
    .order("name");
  return (
    <div className="max-w-5xl">
      <PageHeader title="Employees" />
      <EmployeeManager initial={(data as any[]) ?? []} />
    </div>
  );
}
