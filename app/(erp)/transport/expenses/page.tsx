import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import ExpenseManager from "./ExpenseManager";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const sb = createClient();
  const [{ data: expenses }, { data: vehicles }, { data: drivers }] = await Promise.all([
    sb.from("transport_expenses").select("id, category, amount, currency, spent_on, vehicle_id, driver_id, note").order("spent_on", { ascending: false }).limit(500),
    sb.from("transport_vehicles").select("id, name").order("name"),
    sb.from("transport_drivers").select("id, name").order("name"),
  ]);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Transport Expenses" />
      <p className="mb-4 text-sm text-slate-500">Fuel, tolls, parking, maintenance and other running costs — tracked per vehicle and driver.</p>
      <ExpenseManager initial={(expenses as any[]) ?? []} vehicles={(vehicles as any[]) ?? []} drivers={(drivers as any[]) ?? []} />
    </div>
  );
}
