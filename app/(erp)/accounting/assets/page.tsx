import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import AssetsClient from "./AssetsClient";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const sb = createClient();
  const [{ data: assets }, { data: accs }] = await Promise.all([
    sb.from("fixed_assets").select("id, name, cost, salvage, purchase_date, life_months, accumulated, depreciated_to, status").order("created_at", { ascending: false }),
    sb.from("accounts").select("id, code, name").eq("is_postable", true).eq("subtype", "Fixed Asset").order("code"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Fixed Assets & Depreciation" />
      <AssetsClient assets={(assets ?? []) as any} assetAccounts={(accs ?? []) as any} />
    </div>
  );
}
