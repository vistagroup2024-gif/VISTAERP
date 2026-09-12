import Link from "next/link";
import { guardStaffPage, docRightsFor, staffCan } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";
import HotelInvoices from "@/components/accounting/HotelInvoices";
import TransportInvoices from "@/components/accounting/TransportInvoices";
import VisaInvoicesPanel from "@/components/accounting/VisaInvoicesPanel";
import ServiceChargesPanel from "../../../car-sales/service-charges/ServiceChargesPanel";

export const dynamic = "force-dynamic";

// Every sales invoice in the business, on one screen.
//
// The Sales Invoice is the trade voucher — item lines, stock, COGS. Air Ticket
// Invoice is the second voucher here: a ticket bought from a consolidator and
// sold to the passenger, both sides on one document. The rest are lists the
// Hotel, Transport, Visa and Car Sales modules raise for themselves, and they
// used to sit as separate rows in Transactions → Sales, which put five things
// called "invoice" in one menu and left the operator to remember which screen
// answered which question. They are tabs here instead.
//
// The tab is in the URL rather than in component state, so each panel stays a
// server component that loads its own rows — no client-side refetch, and a tab
// can be linked to directly.
//
// MONTHLY CHARGES CARRIES ITS OWN PERMISSION. The others are all accounting
// screens; that one belongs to Car Sales (`carsales.charges`), so the tab is
// only offered to somebody who may open it. Showing a tab that bounces on click
// is worse than not showing it.
const TABS = [
  { key: "sales", label: "Sales Invoice" },
  { key: "air", label: "Air Ticket" },
  { key: "hotel", label: "Hotel" },
  { key: "transport", label: "Transport" },
  { key: "visa", label: "Visa" },
  { key: "charges", label: "Monthly Charges", perm: "carsales.charges" },
] as const;

export default async function Page({ searchParams }: { searchParams?: { tab?: string } }) {
  const access = await guardStaffPage("accounting.view", "sales_invoice");
  const tabs = TABS.filter((t) => !("perm" in t) || staffCan(access, t.perm));
  const tab = tabs.some((t) => t.key === searchParams?.tab) ? searchParams!.tab! : "sales";
  const wide = tab !== "sales";

  return (
    <div className={wide ? "max-w-6xl" : "max-w-5xl"}>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => (
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
      {tab === "air" && <TradeVoucher type="air_ticket_invoice" rights={docRightsFor(access, "air_ticket_invoice")} />}
      {tab === "hotel" && <HotelInvoices />}
      {tab === "transport" && <TransportInvoices />}
      {tab === "visa" && <VisaInvoicesPanel />}
      {tab === "charges" && <ServiceChargesPanel />}
    </div>
  );
}
