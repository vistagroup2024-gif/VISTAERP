import DrawingsReportView from "./DrawingsReportView";

export const dynamic = "force-dynamic";

// Drawings Report — see DrawingsReportView for the RPC and the reasoning;
// the header (title, PeriodDropdown, Print) is drawn there now, in the
// same row as the title, since it needs the view's own client state.
export default function DrawingsReportPage() {
  return <DrawingsReportView />;
}
