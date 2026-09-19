import CashFlowView from "./CashFlowView";

export const dynamic = "force-dynamic";

// Cash Flow — see CashFlowView for the RPC and the reasoning; the header
// (title, PeriodDropdown, Print) is drawn there, since it needs the view's
// own client state.
export default function CashFlowPage() {
  return <CashFlowView />;
}
