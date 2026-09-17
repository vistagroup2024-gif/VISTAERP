import AgingView from "./AgingView";

export const dynamic = "force-dynamic";

// A/R & A/P Balance — see AgingView for the RPCs and the reasoning; the
// header (title, PeriodDropdown, Print) is drawn there now, in the same
// row as the title, since it needs the view's own client state.
export default function AgingPage() {
  return <AgingView />;
}
