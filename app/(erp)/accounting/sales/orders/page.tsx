import { guardStaffPage } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";
import { TRADE_DOCS } from "@/lib/tradeDocs";

export const dynamic = "force-dynamic";

export default async function Page() {
  await guardStaffPage("accounting.view");
  return <div className="max-w-5xl"><TradeVoucher cfg={TRADE_DOCS.sale_order} /></div>;
}
