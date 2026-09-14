import { redirect } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";

export const dynamic = "force-dynamic";

// Monthly Charges is a tab of Sales Invoice now — the voucher and, under it,
// the register. This route stays so links and bookmarks keep working.
export default async function ServiceChargesPage() {
  await guardStaffPage("carsales.charges");
  redirect("/accounting/sales/invoices?tab=charges");
}
