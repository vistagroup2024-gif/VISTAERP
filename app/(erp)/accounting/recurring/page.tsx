import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { loadPickAccounts } from "@/lib/accounting";
import RecurringClient from "./RecurringClient";

export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  const sb = createClient();
  const [{ data: schedules }, { accounts }] = await Promise.all([
    sb.from("recurring_schedules").select("id, name, cadence, next_run, narration, auto_authorize, active, last_run").order("next_run"),
    loadPickAccounts(),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Recurring Vouchers" />
      <RecurringClient schedules={(schedules ?? []) as any} accounts={accounts} />
    </div>
  );
}
