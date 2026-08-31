import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("invoices")
    .select("id, invoice_no, invoice_date, due_date, currency, total, amount_paid, status, parties:customer_id(name)")
    .order("invoice_date", { ascending: false });

  const list = rows ?? [];

  return (
    <div>
      <PageHeader title="Sales Invoices" subtitle="Generated from confirmed bookings" />
      <div className="panel overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Invoice #</th>
              <th className="th">Customer</th>
              <th className="th">Date</th>
              <th className="th th-num">Total</th>
              <th className="th th-num">Balance</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r: any) => (
              <tr key={r.id}>
                <td className="td font-medium">
                  <Link href={`/invoices/${r.id}`} className="text-brand hover:underline">{r.invoice_no}</Link>
                </td>
                <td className="td">{r.parties?.name ?? "—"}</td>
                <td className="td text-slate-500">{dateStr(r.invoice_date)}</td>
                <td className="td td-num">{money(r.total, r.currency)}</td>
                <td className="td td-num">{money(Number(r.total) - Number(r.amount_paid), r.currency)}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td className="td py-10 text-center text-slate-400" colSpan={6}>No invoices yet. They are generated from confirmed bookings.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
