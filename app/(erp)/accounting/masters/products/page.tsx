import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TreeMaster from "@/components/accounting/TreeMaster";

export const dynamic = "force-dynamic";

export default async function ProductTreePage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("acct_products").select("id, parent_id, name, is_group, is_active, sort").order("sort").order("name");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Product Tree" />
      <TreeMaster table="acct_products" initial={(data as any[]) ?? []}
        note="A hierarchical catalogue of products / service items. Create groups, then items under them." />
    </div>
  );
}
