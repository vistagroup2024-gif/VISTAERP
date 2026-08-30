import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import MasterList from "@/components/accounting/MasterList";

export const dynamic = "force-dynamic";

export default async function TagAreasPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("acct_tag_areas").select("*").order("name");
  return (
    <div className="max-w-3xl">
      <PageHeader title="Tag Areas" />
      <MasterList table="acct_tag_areas" initial={(data as any[]) ?? []}
        note="A second free dimension you can tag on voucher lines (e.g. project, region, campaign)."
        fields={[{ key: "name", label: "Tag Area", width: "sm:col-span-4" }]} />
    </div>
  );
}
