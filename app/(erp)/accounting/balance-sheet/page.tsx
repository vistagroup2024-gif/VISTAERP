import BalanceSheetView from "./BalanceSheetView";

export const dynamic = "force-dynamic";

// Balance Sheet — see BalanceSheetView for the RPC and the reasoning; the
// header (title, PeriodDropdown, Print) is drawn there now, in the same
// row as the title, since it needs the view's own client state.
export default function BalanceSheetPage() {
  return <BalanceSheetView />;
}
