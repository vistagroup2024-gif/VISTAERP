import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import StockReport from "@/components/inventory/StockReport";
import { STOCK_REPORTS } from "@/lib/stockReports";

export const dynamic = "force-dynamic";

const CFG = STOCK_REPORTS["valuation"];

export default async function StockValuationPage() {
  await guardStaffPage("accounting.view");
  return (
    <div>
      <PageHeader title={CFG.title} subtitle={CFG.subtitle} />
      <StockReport report="valuation" />
    </div>
  );
}
