import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";

export const dynamic = "force-dynamic";

export default async function Page() {
  const access = await guardStaffPage("accounting.view", "sales_invoice");
  return <div className="max-w-5xl"><TradeVoucher type="sales_invoice" rights={docRightsFor(access, "sales_invoice")} /></div>;
}
