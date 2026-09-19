import { createClient } from "@/lib/supabase/server";
import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import { notFound } from "next/navigation";
import VehicleExpenseSheet from "./VehicleExpenseSheet";

export const dynamic = "force-dynamic";

// One vehicle's expense sheet. `key` is the same "v:<id>" / "p:<po_line>" the
// landing page's picker uses — a car still on order has no vehicle record
// yet, so it is addressed by its purchase order line until the first expense
// makes one (car_vehicle_ensure_ordered).
export default async function VehicleExpensesPage({ params }: { params: { key: string } }) {
  const access = await guardStaffPage(
    ["carsales.installments", "carsales.sales", "accounting.view"], "car_expense");
  const key = decodeURIComponent(params.key);
  const sb = createClient();

  // The same picker the landing page offers, so a car on order carries the
  // same label, cost-so-far and "still on order" note here as it did there.
  const { data: options } = await sb.rpc("car_expense_vehicle_options");
  const vehicle = ((options ?? []) as any[]).find((v) =>
    (v.kind === "vehicle" ? `v:${v.id}` : `p:${v.po_line}`) === key);
  if (!vehicle) notFound();

  const [{ data: heads }, { data: accounts }, rowsRes] = await Promise.all([
    sb.from("acct_car_purchase_expenses").select("id, name, amount, credit_account").order("name"),
    sb.rpc("car_expense_credit_accounts"),
    // A car still on order has nothing booked against it yet — vehicle_id is
    // NOT NULL on car_vehicle_expenses, so there is nothing to select.
    vehicle.kind === "vehicle"
      ? sb.from("car_vehicle_expenses")
          .select("id, vehicle_id, expense_id, credit_account, expense_name, expense_date, amount, narration, reference")
          .eq("vehicle_id", vehicle.id)
          .order("expense_date", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  return (
    <VehicleExpenseSheet
      vkey={key}
      vehicle={vehicle}
      heads={(heads ?? []) as any}
      accounts={(accounts ?? []) as any}
      rows={(rowsRes.data ?? []) as any}
      rights={docRightsFor(access, "car_expense")}
    />
  );
}
