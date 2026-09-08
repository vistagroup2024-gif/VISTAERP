import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import MasterList from "@/components/accounting/MasterList";

export const dynamic = "force-dynamic";

export default async function CarPurchaseExpensesPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  // The same list the Car Expense voucher offers, from the same routine, so the
  // head cannot remember a vendor the voucher would not accept.
  const [{ data }, { data: accounts }] = await Promise.all([
    sb.from("acct_car_purchase_expenses").select("*").order("name"),
    sb.rpc("car_expense_credit_accounts"),
  ]);
  const vendorOptions = ((accounts ?? []) as any[]).map((a) => ({
    v: a.id, l: `${a.name}${a.subtype && a.subtype !== "Payable" ? ` (${a.subtype})` : ""}`,
  }));

  return (
    <div className="max-w-4xl">
      <PageHeader title="Car Purchase Expenses" />
      <MasterList table="acct_car_purchase_expenses" initial={(data as any[]) ?? []}
        note="Expense heads that can be added onto a vehicle's purchase cost (e.g. transport, customs, refurbishment). The amount and the vendor here are the usual ones — a Car Expense voucher fills both in when the head is chosen, and both stay editable on the voucher."
        fields={[
          { key: "name", label: "Expense Head", width: "sm:col-span-2" },
          { key: "amount", label: "Amount", type: "number", width: "sm:col-span-1", required: false },
          { key: "credit_account", label: "Vendor", type: "select", width: "sm:col-span-2",
            required: false, options: vendorOptions },
        ]} />
    </div>
  );
}
