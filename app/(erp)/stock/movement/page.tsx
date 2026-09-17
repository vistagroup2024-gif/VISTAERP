import { guardStaffPage } from "@/lib/staffSession";
import StockReportPage from "@/components/reports/StockReportPage";

export const dynamic = "force-dynamic";

// ?item=<id> arrives from another Stock report's own drilldown (Valuation,
// Ageing) — pre-fills the Items filter so the owner lands on that item's
// movement already scoped, instead of an empty report they have to filter
// by hand.
export default async function Page({ searchParams }: { searchParams: { item?: string } }) {
  await guardStaffPage("accounting.view");
  return <StockReportPage report="movement" initialFilters={searchParams.item ? { items: [searchParams.item] } : undefined} />;
}
