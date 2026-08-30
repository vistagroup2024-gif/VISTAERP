import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompaniesManager from "./CompaniesManager";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const supabase = createClient();
  const [rows, acc] = await Promise.all([
    supabase.from("group_companies").select("id, name, supplier_account_id").order("name"),
    supabase.from("accounts").select("id, name, code").eq("is_postable", true).eq("is_group", false).like("code", "2-01-%").order("code"),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Companies" />
      <p className="mb-4 text-sm text-slate-500">
        These company names appear in the <b>Company</b> dropdown on the Visa Group form. Set a <b>supplier ledger</b> and
        the Visa invoice posts that company&apos;s cost to it automatically.
      </p>
      <CompaniesManager companies={(rows.data as any[]) ?? []} supplierAccounts={(acc.data as any[]) ?? []} />
    </div>
  );
}
