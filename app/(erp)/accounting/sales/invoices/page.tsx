import { guardStaffPage } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";

export const dynamic = "force-dynamic";

export default async function Page() {
  await guardStaffPage("accounting.view");
  return <div className="max-w-5xl"><TradeVoucher type="sales_invoice" /></div>;
}
