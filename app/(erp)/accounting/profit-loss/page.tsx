import ProfitLossView from "./ProfitLossView";

export const dynamic = "force-dynamic";

// Profit & Loss — see ProfitLossView for the RPCs and the reasoning; the
// header (title, PeriodDropdown, Print) is drawn there now, in the same
// row as the title, since it needs the view's own client state.
export default function ProfitLossPage() {
  return <ProfitLossView />;
}
