import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";

export const dynamic = "force-dynamic";

// ?id=<uuid> opens straight into that order — the Sales Orders report links
// here this way, the same as Air Ticket Bookings does.
export default async function Page({ searchParams }: { searchParams: { id?: string } }) {
  const access = await guardStaffPage("accounting.view", "sale_order");
  return <div className="max-w-5xl"><TradeVoucher type="sale_order" rights={docRightsFor(access, "sale_order")} initialId={searchParams.id} /></div>;
}
