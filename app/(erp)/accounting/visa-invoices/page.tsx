import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";

export const dynamic = "force-dynamic";

// The menu reaches this voucher through Sales Invoice → Visa now. The route
// stays so existing links and bookmarks keep working, and it renders the same
// voucher the tab does.
export default async function VisaInvoicePage() {
  const access = await guardStaffPage("accounting.view", "visa_invoice");
  return (
    <div className="max-w-6xl">
      <TradeVoucher type="visa_invoice" rights={docRightsFor(access, "visa_invoice")} />
    </div>
  );
}
