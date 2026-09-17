import PurchaseVsSaleView from "./PurchaseVsSaleView";

export const dynamic = "force-dynamic";

// Purchase vs Sale — see PurchaseVsSaleView for the RPCs and the reasoning;
// the header (title, PeriodDropdown, Print) is drawn there now, in the
// same row as the title, since it needs the view's own client state.
export default function PurchaseVsSalePage() {
  return <PurchaseVsSaleView />;
}
