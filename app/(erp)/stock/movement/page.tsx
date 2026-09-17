import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import StockReport from "@/components/inventory/StockReport";
import { STOCK_REPORTS } from "@/lib/stockReports";

export const dynamic = "force-dynamic";

const CFG = STOCK_REPORTS["movement"];

// ?item=<id> arrives from another Stock report's own drilldown (Valuation,
// Ageing) — pre-fills the Items filter so the owner lands on that item's
// movement already scoped, instead of an empty report they have to filter
// by hand.
export default async function Page({ searchParams }: { searchParams: { item?: string } }) {
  await guardStaffPage("accounting.view");
  return (
    <div>
      <PageHeader title={CFG.title} subtitle={CFG.subtitle} />
      {/* The report KEY crosses the boundary, never the config object. */}
      <StockReport report="movement" initialFilters={searchParams.item ? { items: [searchParams.item] } : undefined} />
    </div>
  );
}
