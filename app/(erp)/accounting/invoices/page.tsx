import { loadParties, loadIncomeExpenseAccounts } from "@/lib/accounting";
import { createClient } from "@/lib/supabase/server";
import InvoiceEditor from "./InvoiceEditor";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const sb = createClient();
  const [parties, accounts, cc, sp] = await Promise.all([
    loadParties(),
    loadIncomeExpenseAccounts(),
    sb.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
    sb.from("salespersons").select("id, name").eq("is_active", true).order("name"),
  ]);
  return <InvoiceEditor parties={parties as any} accounts={accounts}
    costCenters={(cc.data as any[]) ?? []} salespersons={(sp.data as any[]) ?? []} />;
}
