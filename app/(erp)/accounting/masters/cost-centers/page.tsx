import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TreeMaster from "@/components/accounting/TreeMaster";

export const dynamic = "force-dynamic";

export default async function CostCentersPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("acct_cost_centers").select("id, parent_id, name, is_group, is_active, sort, sales_target").order("sort").order("name");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Cost Centers" />
      <TreeMaster table="acct_cost_centers" initial={(data as any[]) ?? []}
        extra={{ key: "sales_target", label: "Sales Target" }}
        note="Cost centers tag receipts, payments and journals so you can report profit by branch / activity. Group them and set a sales target per centre." />
    </div>
  );
}
