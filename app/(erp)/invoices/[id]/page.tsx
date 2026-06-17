import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InvoiceDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select("*, parties:customer_id(name, address, phone), companies:company_id(name, address, phone, email)")
    .eq("id", params.id)
    .single();
  if (!inv) notFound();

  const { data: lines } = await supabase
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", params.id);

  const c: any = inv;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card space-y-6">
        <div className="flex justify-between">
          <div>
            <h1 className="text-xl font-bold text-brand-dark">{c.companies?.name}</h1>
            <p className="text-sm text-slate-500">{c.companies?.address}</p>
            <p className="text-sm text-slate-500">{c.companies?.phone} · {c.companies?.email}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">INVOICE</p>
            <p className="text-sm">{c.invoice_no}</p>
            <p className="text-sm text-slate-500">{dateStr(c.invoice_date)}</p>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase text-slate-400">Bill to</p>
          <p className="font-medium">{c.parties?.name}</p>
          <p className="text-sm text-slate-500">{c.parties?.address}</p>
        </div>

        <table className="w-full">
          <thead className="border-b border-slate-200">
            <tr>
              <th className="th">Description</th>
              <th className="th text-right">Qty</th>
              <th className="th text-right">Unit</th>
              <th className="th text-right">Total</th>
            </tr>
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
          <div className="flex justify-between"><span>Tax ({c.tax_rate}%)</span><span>{money(c.tax_amount, c.currency)}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-bold"><span>Total</span><span>{money(c.total, c.currency)}</span></div>
          <div className="flex justify-between"><span>Paid</span><span>{money(c.amount_paid, c.currency)}</span></div>
          <div className="flex justify-between font-medium text-brand-dark"><span>Balance</span><span>{money(Number(c.total) - Number(c.amount_paid), c.currency)}</span></div>
        </div>
      </div>
    </div>
  );
}
