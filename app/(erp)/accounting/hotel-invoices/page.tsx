import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import HotelInvoices from "@/components/accounting/HotelInvoices";

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
