import { createClient } from "@/lib/supabase/server";
import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import CostingSheet from "./CostingSheet";

export const dynamic = "force-dynamic";

export default async function ProductCostingPage() {
  const access = await guardStaffPage("accounting.view");
  const sb = createClient();
  const [{ data: products }, { data: sheets }] = await Promise.all([
    sb.from("acct_products").select("id, name, uom, purchase_rate, sell_rate")
      .eq("is_group", false).eq("is_active", true).order("name"),
    sb.rpc("costing_sheets_list", { p_limit: 200 }),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader title="Product Costing" />
      <CostingSheet
        products={(products ?? []) as any}
        sheets={(sheets ?? []) as any}
        rights={docRightsFor(access, "product_costing")}
      />
    </div>
  );
}
