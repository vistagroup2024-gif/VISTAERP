import { redirect } from "next/navigation";

// Customer Summary duplicated the Car Customer Balances report: the exact
// same car_customer_balances() rows, the same eight core columns, just
// reordered — the Outstanding report's own "Customer Due Ageing Summary" tab
// is that same data plus the monthly due/receipts breakdown, so nothing here
// was information Outstanding didn't already show. Rather than run and
// render the identical query a second time, this route now forwards to it —
// an old bookmark or link still lands on the right screen instead of a 404.
export const dynamic = "force-dynamic";

export default function CustomerSummaryRedirect() {
  redirect("/car-sales/reports/outstanding");
}
