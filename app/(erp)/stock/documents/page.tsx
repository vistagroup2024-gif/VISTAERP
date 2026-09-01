import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// Document Processing: every voucher that moves stock, in the order goods
// travel — in from a supplier, around the warehouses, out to a customer. The
// vouchers themselves live in Purchase and Sales; this is the one place that
// gathers them for a storekeeper.
const DOCS: { href: string; label: string; note: string }[] = [
  { href: "/stock/documents/movement", label: "Stock Receipt / Issue / Adjustment",
    note: "Direct stock entry at moving-average cost, with the matching GL post." },
  { href: "/accounting/purchases/orders", label: "Purchase Order",
    note: "What is on order — counts toward virtual stock, moves nothing yet." },
  { href: "/accounting/purchases/mrn", label: "Material Receipt (MRN)",
    note: "Goods arrived against an order, before the supplier's bill." },
  { href: "/accounting/purchases/vouchers", label: "Purchase Voucher",
    note: "Receives stock and posts Dr Inventory / Cr Supplier." },
  { href: "/accounting/purchases/returns", label: "Purchase Return",
    note: "Sends stock back and reverses the supplier's credit." },
  { href: "/accounting/sales/delivery-notes", label: "Delivery Note",
    note: "What left the warehouse — counts as committed stock." },
  { href: "/accounting/sales/returns", label: "Sales Return",
    note: "Takes stock back at cost and reverses the sale." },
];

export default async function DocumentProcessingPage() {
  await guardStaffPage("accounting.view");
  return (
    <div className="max-w-3xl">
      <PageHeader title="Document Processing" subtitle="The vouchers that move stock." />
      <div className="grid gap-3 sm:grid-cols-2">
        {DOCS.map((d) => (
          <Link key={d.href} href={d.href} className="card transition-colors hover:border-brand-300 hover:bg-brand-50/30">
            <p className="font-semibold text-slate-800">{d.label}</p>
            <p className="mt-1 text-sm text-slate-500">{d.note}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
