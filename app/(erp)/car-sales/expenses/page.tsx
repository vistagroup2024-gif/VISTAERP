import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import CarExpenseForm from "./CarExpenseForm";
import { vehicleTitle } from "../lib";

export const dynamic = "force-dynamic";

// Car Expense: the costs that land on a vehicle after it is bought —
// registration, insurance, transport, customs. They used to be nine columns on
// the Purchase Voucher, which meant knowing them on the day of purchase and
// which never actually reached the vehicle's cost. Raised here they do: each
// one capitalises into Vehicle Inventory and adds to that car's Total Cost.
export default async function CarExpensesPage() {
  await guardStaffPage(["carsales.installments", "carsales.sales", "accounting.view"]);
  const sb = createClient();
  const [{ data: vehicles }, { data: heads }, { data: accounts }, { data: rows }] = await Promise.all([
    sb.from("car_vehicles").select("*, item:product_id(name)").order("created_at", { ascending: false }),
    sb.from("acct_car_purchase_expenses").select("id, name, amount").order("name"),
    sb.from("accounts").select("id, name, code, subtype").eq("is_group", false)
      .in("subtype", ["Payable", "Cash", "Bank"]).order("code"),
    sb.from("car_vehicle_expenses")
      .select("id, expense_name, expense_date, amount, narration, reference, vehicle:vehicle_id(vehicle_no, make, model, model_year, plate_no)")
      .order("expense_date", { ascending: false }).limit(500),
  ]);

  const vOpts = (vehicles ?? []).map((v: any) => ({
    id: v.id,
    label: `${vehicleTitle({ ...v, item: v.item?.name })} · ${v.plate_no ?? v.vehicle_no}`,
    cost: Number(v.total_cost || 0),
  }));

  return (
    <CarExpenseForm
      vehicles={vOpts}
      heads={(heads ?? []) as any}
      accounts={(accounts ?? []) as any}
      rows={(rows ?? []) as any}
    />
  );
}
