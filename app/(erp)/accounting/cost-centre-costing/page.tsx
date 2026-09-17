import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import CostCentreCostingView from "./CostCentreCostingView";

export const dynamic = "force-dynamic";

// Cost Centre Costing — see CostCentreCostingView for the RPC and the
// Group -> Cost Centre -> Month hierarchy; this file is just page chrome.
export default function CostCentreCostingPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Cost Centre Costing" subtitle="Each cost centre's own target, sales, cost of sales, gross profit and expense — by group, and by month.">
        <PrintButton />
      </PageHeader>
      <CostCentreCostingView />
    </div>
  );
}
