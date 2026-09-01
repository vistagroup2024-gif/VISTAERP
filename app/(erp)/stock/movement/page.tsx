import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import StockReport from "@/components/inventory/StockReport";
import { STOCK_REPORTS } from "@/lib/stockReports";

export const dynamic = "force-dynamic";

const CFG = STOCK_REPORTS["movement"];

export default async function Page() {
  await guardStaffPage("accounting.view");
  return (
    <div>
      <PageHeader title={CFG.title} subtitle={CFG.subtitle} />
      {/* The report KEY crosses the boundary, never the config object. */}
      <StockReport report="movement" />
    </div>
  );
}
