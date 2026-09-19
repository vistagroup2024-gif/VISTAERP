import { createClient } from "@/lib/supabase/server";
import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import CarExpenseLanding from "./CarExpenseLanding";

export const dynamic = "force-dynamic";

// Car Expense: the costs that land on a vehicle after it is bought —
// registration, insurance, transport, customs. Each one capitalises into
// Vehicle Inventory and adds to that car's Total Cost.
//
// One sheet per vehicle, not one voucher per line: this page only picks
// which vehicle to open. A vehicle with nothing booked on it yet is offered
// in the picker below; the moment it has a first line, car_expense_vehicle_summary
// picks it up and it moves into "Vehicles with expenses" instead — open it
// there to add the next one. That split is what keeps a car that already has
// three lines on it from being offered as a fresh pick a fourth time.
export default async function CarExpensesPage() {
  const access = await guardStaffPage(
    ["carsales.installments", "carsales.sales", "accounting.view"], "car_expense");
  const sb = createClient();
  const [{ data: vehicles }, { data: summary }] = await Promise.all([
    sb.rpc("car_expense_vehicle_options"),
    sb.rpc("car_expense_vehicle_summary"),
  ]);

  const started = new Set(((summary ?? []) as any[]).map((s) => s.vehicle_id));
  // A po_line option has no vehicle_id yet, so it can never be "started" —
  // only a real vehicle can already be in the summary.
  const fresh = ((vehicles ?? []) as any[]).filter((v) => v.kind !== "vehicle" || !started.has(v.id));

  return (
    <CarExpenseLanding
      vehicles={fresh as any}
      summary={(summary ?? []) as any}
      rights={docRightsFor(access, "car_expense")}
    />
  );
}
