import SalesReportView from "./SalesReportView";

export const dynamic = "force-dynamic";

// Sales Report — the dashboard's Sales card detail screen. See
// SalesReportView for the RPCs and the reasoning; the header (title,
// PeriodDropdown, Print) is drawn there now, in the same row as the title,
// since it needs the view's own client state.
export default function SalesReportPage() {
  return <SalesReportView />;
}
