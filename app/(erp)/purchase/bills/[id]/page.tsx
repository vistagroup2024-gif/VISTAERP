import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { dateStr, money } from "@/lib/format";
import BillActions from "./BillActions";

export const dynamic = "force-dynamic";

export default async function BillDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: bill } = await supabase
    .from("bills")
    .select("*, parties:supplier_id(name, address), bookings:booking_id(booking_no)")
    .eq("id", params.id)
    .single();
  if (!bill) notFound();

  const { data: lines } = await supabase.from("bill_lines").select("*").eq("bill_id", params.id);
  const c: any = bill;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BillActions billId={c.id} currency={c.currency} balance={Number(c.total) - Number(c.amount_paid)} />

      <div className="card space-y-6">
        <div className="flex justify-between">
          <div>
            <p className="text-xs uppercase text-slate-400">Supplier</p>
            <p className="font-medium">{c.parties?.name}</p>
            {c.bookings?.booking_no && <p className="text-sm text-slate-500">Booking {c.bookings.booking_no}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">BILL</p>
            <p className="text-sm font-mono">{c.bill_no}</p>
            <p className="text-sm text-slate-500">{dateStr(c.bill_date)}</p>
          </div>
        </div>

        <table className="w-full">
          <thead className="border-b border-slate-200">
            <tr><th className="th">Description</th><th className="th text-right">Qty</th><th className="th text-right">Unit</th><th className="th text-right">Total</th></tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="td">{l.description}</td>
                <td className="td text-right">{l.qty}</td>
                <td className="td text-right">{money(l.unit_price, c.currency)}</td>
                <td className="td text-right">{money(l.line_total, c.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{money(c.subtotal, c.currency)}</span></div>
          <div className="flex justify-between"><span>Tax</span><span>{money(c.tax_amount, c.currency)}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-bold"><span>Total</span><span>{money(c.total, c.currency)}</span></div>
          <div className="flex justify-between"><span>Paid</span><span>{money(c.amount_paid, c.currency)}</span></div>
          <div className="flex justify-between font-medium text-brand-dark"><span>Balance</span><span>{money(Number(c.total) - Number(c.amount_paid), c.currency)}</span></div>
          <div className="flex justify-between text-slate-400"><span>FX → PKR</span><span>{c.fx_rate}</span></div>
        </div>
      </div>
    </div>
  );
}
