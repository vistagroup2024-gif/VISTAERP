import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TransportInvoices from "@/components/accounting/TransportInvoices";

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
