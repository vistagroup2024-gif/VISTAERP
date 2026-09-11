import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TransportInvoices from "@/components/accounting/TransportInvoices";

// The menu reaches this list through Sales Invoice → Transport now. The route stays so
// existing links and bookmarks keep working.
export const dynamic = "force-dynamic";

export default async function TransportInvoicesPage() {
  await guardStaffPage("accounting.view");
  return (
    <div className="max-w-6xl">
      <PageHeader title="Transport Invoices" />
      <TransportInvoices />
    </div>
  );
}
