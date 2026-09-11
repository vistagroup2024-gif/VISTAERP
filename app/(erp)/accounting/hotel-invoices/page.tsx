import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import HotelInvoices from "@/components/accounting/HotelInvoices";

// The menu reaches this list through Sales Invoice → Hotel now. The route stays so
// existing links and bookmarks keep working.
export const dynamic = "force-dynamic";

export default async function HotelInvoicesPage() {
  await guardStaffPage("accounting.view");
  return (
    <div className="max-w-6xl">
      <PageHeader title="Hotel Invoices" />
      <HotelInvoices />
    </div>
  );
}
