import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";

export const dynamic = "force-dynamic";

// ?id=<uuid> opens straight into that order — the Purchase Orders report
// links here this way.
export default async function Page({ searchParams }: { searchParams: { id?: string } }) {
  const access = await guardStaffPage("accounting.view", "purchase_order");
  return <div className="max-w-5xl"><TradeVoucher type="purchase_order" rights={docRightsFor(access, "purchase_order")} initialId={searchParams.id} /></div>;
}
