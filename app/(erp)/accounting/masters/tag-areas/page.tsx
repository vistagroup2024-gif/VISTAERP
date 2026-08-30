import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TreeMaster from "@/components/accounting/TreeMaster";

export const dynamic = "force-dynamic";

export default async function TagAreasPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("acct_tag_areas").select("id, parent_id, name, is_group, is_active, sort").order("sort").order("name");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Tag Areas" />
      <TreeMaster table="acct_tag_areas" initial={(data as any[]) ?? []}
        note="A second free dimension you can tag on voucher lines (e.g. project, region, campaign). Group them as needed." />
    </div>
  );
}
