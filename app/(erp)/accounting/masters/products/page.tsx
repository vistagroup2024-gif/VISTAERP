import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import ProductTree from "@/components/accounting/ProductTree";

export const dynamic = "force-dynamic";

export default async function ProductTreePage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("acct_products").select("id, parent_id, name, is_group, is_active, sort").order("sort").order("name");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Product Tree" />
      <ProductTree initial={(data as any[]) ?? []} />
    </div>
  );
}
