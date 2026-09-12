import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TreeMaster from "@/components/accounting/TreeMaster";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

export const dynamic = "force-dynamic";

// Full width, like the Chart of Accounts: the toolbar carries the same dozen
// buttons and a 4xl column folded them onto three lines.
export default async function ProductTreePage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  // Paged rather than a bare select: PostgREST stops at 1000 rows and says
  // nothing, and this tree is a few hundred and only ever grows.
  const { data } = await fetchAllRows<any>((from, to) =>
    sb.from("acct_products")
      .select("id, parent_id, name, is_group, is_active, sort, purchase_rate, sell_rate")
      .order("id").range(from, to));
  return (
    <div>
      <PageHeader title="Product Tree" />
      <TreeMaster table="acct_products" initial={data ?? []} rateEditor
        note="A hierarchical catalogue of products / service items. Create groups, then items under them. Select an item and press 'Rates' to set the default Purchase/Sell rate and per-customer / per-supplier overrides — these price the module invoices automatically." />
    </div>
  );
}
