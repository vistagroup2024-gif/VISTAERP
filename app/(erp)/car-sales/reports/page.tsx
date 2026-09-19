import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";

export const dynamic = "force-dynamic";

const REPORTS = [
  { href: "/car-sales/reports/outstanding", title: "Car Customer Balances", desc: "Ageing summary (default), installment aging, and month-by-month due & receipts — same figures as the dashboard card." },
  { href: "/car-sales/reports/delivery", title: "Car Delivery Report", desc: "Sold vehicles and delivery status, with the invoice that sold them." },
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
