import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SupplierPaymentsPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("payments")
    .select("id, payment_no, payment_date, amount, currency, parties:party_id(name), bills:bill_id(bill_no)")
    .eq("payment_type", "payment")
    .order("payment_date", { ascending: false });

  const total = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div>
      <PageHeader title="Supplier Payments" />
      <div className="mb-4 card">
        <p className="text-sm text-slate-500">Total paid to suppliers (mixed currency, indicative)</p>
        <p className="text-2xl font-bold text-brand-dark">{money(total, "PKR")}</p>
      </div>
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Payment #</th>
              <th className="th">Date</th>
              <th className="th">Supplier</th>
              <th className="th">Bill</th>
              <th className="th text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td font-mono">{r.payment_no}</td>
                <td className="td">{dateStr(r.payment_date)}</td>
                <td className="td">{r.parties?.name ?? "—"}</td>
                <td className="td">{r.bills?.bill_no ?? "—"}</td>
                <td className="td text-right font-medium">{money(r.amount, r.currency)}</td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={5}>No supplier payments yet. Record one from a bill.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
