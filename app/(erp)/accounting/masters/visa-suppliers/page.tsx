import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import GroupSupplierMap from "@/components/accounting/GroupSupplierMap";

export const dynamic = "force-dynamic";

export default async function VisaSuppliersPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const [gc, acc] = await Promise.all([
    sb.from("group_companies").select("id, name, supplier_account_id").order("name"),
    sb.from("accounts").select("id, code, name").eq("is_postable", true).eq("is_group", false)
      .like("code", "2-01-%").order("code"),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Visa Supplier Accounts" />
      <GroupSupplierMap groupCompanies={(gc.data as any[]) ?? []} supplierAccounts={(acc.data as any[]) ?? []} />
    </div>
  );
}
