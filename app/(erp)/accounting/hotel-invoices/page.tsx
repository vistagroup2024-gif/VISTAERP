import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";

export const dynamic = "force-dynamic";

// The menu reaches this voucher through Sales Invoice → Hotel now. The route
// stays so existing links and bookmarks keep working, and it renders the same
// voucher the tab does.
export default async function HotelInvoicePage() {
  const access = await guardStaffPage("accounting.view", "hotel_invoice");
  return (
    <div className="max-w-6xl">
      <TradeVoucher type="hotel_invoice" rights={docRightsFor(access, "hotel_invoice")} />
    </div>
  );
}
