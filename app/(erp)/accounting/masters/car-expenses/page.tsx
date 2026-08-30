import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import MasterList from "@/components/accounting/MasterList";

export const dynamic = "force-dynamic";

export default async function CarPurchaseExpensesPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("acct_car_purchase_expenses").select("*").order("name");
  return (
    <div className="max-w-3xl">
      <PageHeader title="Car Purchase Expenses" />
      <MasterList table="acct_car_purchase_expenses" initial={(data as any[]) ?? []}
        note="Expense heads that can be added onto a vehicle's purchase cost (e.g. transport, customs, refurbishment)."
        fields={[{ key: "name", label: "Expense Head", width: "sm:col-span-4" }]} />
    </div>
  );
}
