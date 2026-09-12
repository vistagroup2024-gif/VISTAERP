import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TreeMaster from "@/components/accounting/TreeMaster";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

export const dynamic = "force-dynamic";

export default async function TagAreasPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await fetchAllRows<any>((from, to) =>
    sb.from("acct_tag_areas")
      .select("id, parent_id, name, is_group, is_active, sort")
      .order("id").range(from, to));
  return (
    <div>
      <PageHeader title="Tag Areas" />
      <TreeMaster table="acct_tag_areas" initial={data ?? []}
        note="A second free dimension you can tag on voucher lines (e.g. project, region, campaign). Group them as needed." />
    </div>
  );
}
