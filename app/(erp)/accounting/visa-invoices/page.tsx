import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import VisaInvoicesPanel from "@/components/accounting/VisaInvoicesPanel";

export const dynamic = "force-dynamic";

// The menu reaches this list through Sales Invoice → Visa now. The route stays
// so existing links and bookmarks keep working, and it renders the same panel
// the tab does.
export default async function VisaInvoicesPage() {
  await guardStaffPage("accounting.view");
  return (
    <div className="max-w-6xl">
      <PageHeader title="Visa Invoices" />
      <VisaInvoicesPanel />
    </div>
  );
}
