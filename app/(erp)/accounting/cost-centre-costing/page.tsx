import CostCentreCostingView from "./CostCentreCostingView";

export const dynamic = "force-dynamic";

// Cost Centre Costing — see CostCentreCostingView for the RPC and the
// Group -> Cost Centre -> Month hierarchy; the header (title,
// PeriodDropdown, Print) is drawn there now, in the same row as the title,
// since it needs the view's own client state.
export default function CostCentreCostingPage() {
  return <CostCentreCostingView />;
}
