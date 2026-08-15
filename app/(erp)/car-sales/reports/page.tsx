import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";

export const dynamic = "force-dynamic";

const REPORTS = [
  { href: "/car-sales/reports/outstanding", title: "Outstanding Details", desc: "Per-contract paid, outstanding, due & overdue." },
  { href: "/car-sales/reports/aging", title: "Installment Aging", desc: "Overdue buckets: current / 1-30 / 31-60 / 61-90 / 90+." },
  { href: "/car-sales/reports/upcoming", title: "Upcoming Collection", desc: "Installments due soon, with contact numbers." },
  { href: "/car-sales/reports/held", title: "Vehicles Held by Vista", desc: "Retained vehicles with outstanding & agreement notes." },
  { href: "/car-sales/reports/service-charges", title: "Monthly Service Charges", desc: "Charge status by vehicle & ownership." },
  { href: "/car-sales/reports/customer-summary", title: "Customer Summary", desc: "Per-customer ledger, due & overdue." },
  { href: "/car-sales/reports/profitability", title: "Vehicle Profitability", desc: "Purchase vs sale, profit, collected & outstanding." },
];

export default async function ReportsIndex() {
  await guardStaffPage("carsales.reports");
  return (
    <div>
      <PageHeader title="Car Sales Reports" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href} className="card hover:shadow-md">
            <div className="font-semibold text-slate-800">{r.title}</div>
            <div className="mt-1 text-sm text-slate-500">{r.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
