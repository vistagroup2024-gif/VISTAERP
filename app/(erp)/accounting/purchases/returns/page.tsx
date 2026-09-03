import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";

export const dynamic = "force-dynamic";

export default async function Page() {
  const access = await guardStaffPage("accounting.view", "purchase_return");
  return <div className="max-w-5xl"><TradeVoucher type="purchase_return" rights={docRightsFor(access, "purchase_return")} /></div>;
}
