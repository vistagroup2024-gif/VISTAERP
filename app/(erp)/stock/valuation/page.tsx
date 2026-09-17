import { guardStaffPage } from "@/lib/staffSession";
import StockReportPage from "@/components/reports/StockReportPage";

export const dynamic = "force-dynamic";

export default async function StockValuationPage() {
  await guardStaffPage("accounting.view");
  return <StockReportPage report="valuation" />;
}
