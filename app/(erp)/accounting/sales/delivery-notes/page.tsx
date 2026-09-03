import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";

export const dynamic = "force-dynamic";

export default async function Page() {
  const access = await guardStaffPage("accounting.view", "delivery_note");
  return <div className="max-w-5xl"><TradeVoucher type="delivery_note" rights={docRightsFor(access, "delivery_note")} /></div>;
}
