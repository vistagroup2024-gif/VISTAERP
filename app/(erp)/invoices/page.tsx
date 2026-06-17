import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  issued: "bg-blue-100 text-blue-700",
  partially_paid: "bg-amber-100 text-amber-700",
  paid: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-700",
};

export default async function InvoicesPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("invoices")
    .select("id, invoice_no, invoice_date, due_date, currency, total, amount_paid, status, parties:customer_id(name)")
    .order("invoice_date", { ascending: false });

  return (
    <div>
      <PageHeader title="Sales Invoices" />
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Invoice #</th>
              <th className="th">Customer</th>
              <th className="th">Date</th>
              <th className="th text-right">Total</th>
              <th className="th text-right">Balance</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td font-medium">
                  <Link href={`/invoices/${r.id}`} className="text-brand hover:underline">{r.invoice_no}</Link>
                </td>
                <td className="td">{r.parties?.name ?? "—"}</td>
                <td className="td">{dateStr(r.invoice_date)}</td>
                <td className="td text-right">{money(r.total, r.currency)}</td>
                <td className="td text-right">{money(Number(r.total) - Number(r.amount_paid), r.currency)}</td>
                <td className="td"><span className={`badge ${STATUS_COLOR[r.status]}`}>{r.status.replace("_", " ")}</span></td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>No invoices yet. They are generated from confirmed bookings.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
