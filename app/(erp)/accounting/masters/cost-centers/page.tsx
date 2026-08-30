import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import MasterList from "@/components/accounting/MasterList";

export const dynamic = "force-dynamic";

export default async function CostCentersPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("acct_cost_centers").select("*").order("name");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Cost Centers" />
      <MasterList table="acct_cost_centers" initial={(data as any[]) ?? []}
        note="Cost centers tag receipts, payments and journals so you can report profit by branch / activity."
        fields={[
          { key: "name", label: "Cost Center", width: "sm:col-span-2" },
          { key: "code", label: "Code", width: "sm:col-span-1", required: false },
          { key: "sales_target", label: "Sales Target", type: "number", width: "sm:col-span-1", required: false },
        ]} />
    </div>
  );
}
