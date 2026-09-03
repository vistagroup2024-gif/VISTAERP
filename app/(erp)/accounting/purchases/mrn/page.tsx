import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";

export const dynamic = "force-dynamic";

export default async function Page() {
  const access = await guardStaffPage("accounting.view", "mrn");
  return <div className="max-w-5xl"><TradeVoucher type="mrn" rights={docRightsFor(access, "mrn")} /></div>;
}
