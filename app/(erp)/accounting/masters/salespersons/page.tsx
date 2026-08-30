import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import SalespersonManager from "@/components/accounting/SalespersonManager";

export const dynamic = "force-dynamic";

export default async function SalespersonsPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const [sp, rules, cc] = await Promise.all([
    sb.from("salespersons").select("id, name, phone, is_active").order("name"),
    sb.from("commission_rules").select("id, salesperson_id, cost_center, method, rate, is_active").order("cost_center"),
    sb.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Salespersons & Commission" />
      <SalespersonManager
        initialSalespersons={(sp.data as any[]) ?? []}
        initialRules={(rules.data as any[]) ?? []}
        costCenters={(cc.data as any[]) ?? []} />
    </div>
  );
}
