import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TreeMaster from "@/components/accounting/TreeMaster";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

export const dynamic = "force-dynamic";

export default async function CostCentersPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await fetchAllRows<any>((from, to) =>
    sb.from("acct_cost_centers")
      .select("id, parent_id, name, is_group, is_active, sort")
      .order("id").range(from, to));
  return (
    <div>
      <PageHeader title="Cost Centers" />
      <TreeMaster table="acct_cost_centers" initial={data ?? []} targetsEditor
        note="Cost centers tag receipts, payments and journals so you can report profit by branch / activity. Edit a cost centre and open its Targets tab to set a month-wise sales target." />
    </div>
  );
}
