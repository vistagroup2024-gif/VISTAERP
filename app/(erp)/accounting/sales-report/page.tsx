import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import SalesReportView from "./SalesReportView";

export const dynamic = "force-dynamic";

// Sales Report — the dashboard's Sales card detail screen. See
// SalesReportView for the RPCs and the reasoning; this file is just the
// page chrome, the same split cash-bank/page.tsx already uses for its own
// client view.
export default function SalesReportPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Sales Report" subtitle="Every sale the business made — Sales Invoice, the service invoices, and the Car Invoice — for the chosen period.">
        <PrintButton />
      </PageHeader>
      <SalesReportView />
    </div>
  );
}
