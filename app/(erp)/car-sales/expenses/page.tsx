import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import CarExpenseForm from "./CarExpenseForm";

export const dynamic = "force-dynamic";

// Car Expense: the costs that land on a vehicle after it is bought —
// registration, insurance, transport, customs. They used to be nine columns on
// the Purchase Voucher, which meant knowing them on the day of purchase and
// which never actually reached the vehicle's cost. Raised here they do: each
// one capitalises into Vehicle Inventory and adds to that car's Total Cost.
export default async function CarExpensesPage() {
  await guardStaffPage(["carsales.installments", "carsales.sales", "accounting.view"]);
  const sb = createClient();
  // The vehicle list is built in SQL rather than here, because it is TWO lists:
  // the cars in the yard and the cars still on a purchase order that nothing has
  // made a record for yet. The second half only exists as a document line, so
  // there is nothing in car_vehicles to select it from.
  const [{ data: vehicles }, { data: heads }, { data: accounts }, { data: rows }] = await Promise.all([
    sb.rpc("car_expense_vehicle_options"),
    sb.from("acct_car_purchase_expenses").select("id, name, amount, credit_account").order("name"),
    sb.rpc("car_expense_credit_accounts"),
    sb.from("car_vehicle_expenses")
      .select("id, expense_name, expense_date, amount, narration, reference, vehicle:vehicle_id(vehicle_no, make, model, model_year, plate_no)")
      .order("expense_date", { ascending: false }).limit(500),
  ]);

  return (
    <CarExpenseForm
      vehicles={(vehicles ?? []) as any}
      heads={(heads ?? []) as any}
      accounts={(accounts ?? []) as any}
      rows={(rows ?? []) as any}
    />
  );
}
