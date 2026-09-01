import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import StockLedger from "@/components/inventory/StockLedger";

export const dynamic = "force-dynamic";

export default async function StockLedgerPage() {
  await guardStaffPage("accounting.view");
  return (
    <div>
      <PageHeader title="Stock Ledger"
        subtitle="Every receipt and issue per item, with a running quantity and value balance." />
      <StockLedger />
    </div>
  );
}
