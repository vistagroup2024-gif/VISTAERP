import Link from "next/link";
import { redirect } from "next/navigation";
import { guardStaffPage, docRightsFor, staffCan, staffDocCan, staffLanding } from "@/lib/staffSession";
import TradeVoucher from "@/components/accounting/TradeVoucher";
import MonthlyChargesVoucher from "@/components/carsales/MonthlyChargesVoucher";
import VehicleTransferVoucher from "@/components/carsales/VehicleTransferVoucher";
import ServiceChargesPanel from "../../../car-sales/service-charges/ServiceChargesPanel";

export const dynamic = "force-dynamic";

// Every sales invoice in the business, on one screen, and every one of them a
// VOUCHER. The Sales Invoice is the trade voucher with stock and COGS; Air
// Ticket, Hotel, Transport and Visa are the four service invoices — a customer
// and a supplier on one document, four legs, no stock — three of which the
// modules raise by themselves (migration 377) and all of which can be typed
// here. Monthly Charges is the car module's one voucher a month.
//
// The tab is in the URL rather than in component state, so each panel stays a
// server component and a tab can be linked to directly.
//
// MONTHLY CHARGES AND VEHICLE TRANSFER EACH CARRY THEIR OWN PERMISSION, and
// each is the ONLY place its screen is reached from. So this page opens for
// `carsales.charges` and `carsales.ownership` as well as for
// `accounting.view`, showing only the tabs the user may see — a user who
// holds only one of those lands on that tab, not on a bounce.
const TABS = [
  { key: "sales",     label: "Sales Invoice",    perm: "accounting.view", doc: "sales_invoice" },
  { key: "air",       label: "Air Ticket",       perm: "accounting.view", doc: "air_ticket_invoice" },
  { key: "hotel",     label: "Hotel",            perm: "accounting.view", doc: "hotel_invoice" },
  { key: "transport", label: "Transport",        perm: "accounting.view", doc: "transport_invoice" },
  { key: "visa",      label: "Visa",             perm: "accounting.view", doc: "visa_invoice" },
  { key: "charges",   label: "Monthly Charges",  perm: "carsales.charges" },
  { key: "transfer",  label: "Vehicle Transfer", perm: "carsales.ownership" },
] as const;

export default async function Page({ searchParams }: { searchParams?: { tab?: string; vehicle?: string } }) {
  const access = await guardStaffPage(["accounting.view", "carsales.charges", "carsales.ownership"]);
  const tabs = TABS.filter((t) => staffCan(access, t.perm) && (!("doc" in t) || staffDocCan(access, t.doc, "access")));
  if (tabs.length === 0) redirect(staffLanding(access));
  const tab = tabs.some((t) => t.key === searchParams?.tab) ? searchParams!.tab! : tabs[0].key;
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
      {tab === "hotel" && <TradeVoucher type="hotel_invoice" rights={docRightsFor(access, "hotel_invoice")} />}
      {tab === "transport" && <TradeVoucher type="transport_invoice" rights={docRightsFor(access, "transport_invoice")} />}
      {tab === "visa" && <TradeVoucher type="visa_invoice" rights={docRightsFor(access, "visa_invoice")} />}
      {tab === "charges" && (
        <div className="space-y-6">
          <MonthlyChargesVoucher canEdit={staffCan(access, "carsales.charges")} />
          {/* Every month at once — what is outstanding, what was collected —
              stays below the voucher rather than on a screen of its own. */}
          <details className="card p-0">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">All months — register</summary>
            <div className="border-t border-slate-100 p-4"><ServiceChargesPanel /></div>
          </details>
        </div>
      )}
      {tab === "transfer" && (
        <VehicleTransferVoucher canEdit={staffCan(access, "carsales.ownership")} initialVehicleId={searchParams?.vehicle} />
      )}
    </div>
  );
}
