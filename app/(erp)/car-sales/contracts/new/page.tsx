import { redirect } from "next/navigation";

// There is no separate "new car invoice" page any more: the voucher screen
// opens blank, the way every other voucher does. The route stays so older
// links and bookmarks keep working.
export default function NewCarInvoicePage() {
  redirect("/car-sales/contracts");
}
