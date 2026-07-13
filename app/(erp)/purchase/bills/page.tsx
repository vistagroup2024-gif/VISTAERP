import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import DeleteButton from "@/components/DeleteButton";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  issued: "bg-blue-100 text-blue-700",
  partially_paid: "bg-amber-100 text-amber-700",
  paid: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-700",
};

export default async function BillsPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("bills")
    .select("id, bill_no, bill_date, currency, total, amount_paid, status, parties:supplier_id(name), bookings:booking_id(booking_no)")
    .order("bill_date", { ascending: false });

  return (
    <div>
      <PageHeader title="Supplier Bills" action={{ href: "/purchase/bills/new", label: "+ New Bill" }} />
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Bill #</th>
              <th className="th">Supplier</th>
              <th className="th">Booking</th>
              <th className="th">Date</th>
              <th className="th text-right">Total</th>
              <th className="th text-right">Balance</th>
              <th className="th">Status</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td font-mono">
                  <Link href={`/purchase/bills/${r.id}`} className="text-brand hover:underline">{r.bill_no}</Link>
                </td>
                <td className="td">{r.parties?.name ?? "—"}</td>
                <td className="td">{r.bookings?.booking_no ?? "—"}</td>
                <td className="td">{dateStr(r.bill_date)}</td>
                <td className="td text-right">{money(r.total, r.currency)}</td>
                <td className="td text-right">{money(Number(r.total) - Number(r.amount_paid), r.currency)}</td>
                <td className="td"><span className={`badge ${STATUS_COLOR[r.status]}`}>{r.status.replace("_", " ")}</span></td>
                <td className="td"><DeleteButton rpc="delete_bill" paramName="p_bill" id={r.id} confirmText="Delete this bill? Its GL entry will be reversed. This cannot be undone." /></td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={8}>No supplier bills yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
