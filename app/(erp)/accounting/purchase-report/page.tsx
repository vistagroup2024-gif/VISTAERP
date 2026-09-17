import PurchaseReportView from "./PurchaseReportView";

export const dynamic = "force-dynamic";

// Purchase Report — see PurchaseReportView for the RPC and the reasoning;
// the header (title, PeriodDropdown, Print) is drawn there now, in the
// same row as the title, since it needs the view's own client state.
export default function PurchaseReportPage() {
  return <PurchaseReportView />;
}
