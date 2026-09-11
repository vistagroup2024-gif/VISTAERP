import Link from "next/link";
import { guardStaffPage, docRightsFor } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";
import HotelInvoices from "@/components/accounting/HotelInvoices";
import TransportInvoices from "@/components/accounting/TransportInvoices";
import VisaInvoicesPanel from "@/components/accounting/VisaInvoicesPanel";

export const dynamic = "force-dynamic";

// Every sales invoice in the business, on one screen.
//
// The Sales Invoice is the trade voucher — item lines, stock, COGS. The other
// three are the invoices the Hotel, Transport and Visa modules raise for
// themselves, and they used to sit as three more rows in Transactions → Sales,
// which put four things called "invoice" in one menu and left the operator to
// remember which screen answered which question. They are tabs here instead.
//
// The tab is in the URL rather than in component state, so each panel stays a
// server component that loads its own rows — no client-side refetch, and a tab
// can be linked to directly.
const TABS = [
  { key: "sales", label: "Sales Invoice" },
  { key: "hotel", label: "Hotel" },
  { key: "transport", label: "Transport" },
  { key: "visa", label: "Visa" },
] as const;

export default async function Page({ searchParams }: { searchParams?: { tab?: string } }) {
  const access = await guardStaffPage("accounting.view", "sales_invoice");
  const tab = TABS.some((t) => t.key === searchParams?.tab) ? searchParams!.tab! : "sales";

  return (
    <div className={tab === "sales" ? "max-w-5xl" : "max-w-6xl"}>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link key={t.key} href={`/accounting/sales/invoices?tab=${t.key}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              t.key === tab
                ? "border-brand font-semibold text-brand"
                : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "sales" && <TradeVoucher type="sales_invoice" rights={docRightsFor(access, "sales_invoice")} />}
      {tab === "hotel" && <HotelInvoices />}
      {tab === "transport" && <TransportInvoices />}
      {tab === "visa" && <VisaInvoicesPanel />}
    </div>
  );
}
