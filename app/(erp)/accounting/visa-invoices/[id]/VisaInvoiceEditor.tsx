"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";

type Inv = {
  id: string; doc_no: string; doc_date: string; item_name: string; visa_type: string;
  nights: number; pax: number; sell_rate: number; purchase_rate: number; gross_sell: number;
  discount: number; sell_amount: number; cost_amount: number; narration: string | null; haji_name: string | null; status: string;
};
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);

// The Visa Invoice voucher — auto-filled, editable (discount / rate / date),
// printable. Saving re-posts the GL.
export default function VisaInvoiceEditor({ invoice, agentName, supplierName }: {
  invoice: Inv; agentName: string; supplierName: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [date, setDate] = useState(invoice.doc_date);
  const [sellRate, setSellRate] = useState(String(Number(invoice.sell_rate)));
  const [purRate, setPurRate] = useState(String(Number(invoice.purchase_rate)));
  const [discount, setDiscount] = useState(String(Number(invoice.discount)));
  const [narration, setNarration] = useState(invoice.narration ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const gross = num(sellRate) * invoice.pax;
  const net = gross - num(discount);
  const cost = num(purRate) * invoice.pax;

  async function save() {
    setErr(null); setDone(null); setBusy(true);
    const { error } = await supabase.rpc("visa_invoice_save", {
      p_id: invoice.id, p_doc_date: date, p_discount: num(discount),
      p_sell_rate: num(sellRate), p_purchase_rate: num(purRate), p_narration: narration || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone("Saved & re-posted"); router.refresh();
  }
  async function del() {
    if (!confirm(`Delete Visa Invoice ${invoice.doc_no}? Its GL entries are removed too.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("visa_invoice_delete", { p_id: invoice.id });
    setBusy(false);
    if (error) return setErr(error.message);
    router.push("/accounting/visa-invoices");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Link href="/accounting/visa-invoices" className="btn-outline text-sm">← Visa Invoices</Link>
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-700">{done}</span>}
        {err && <span className="rounded bg-red-50 px-3 py-1 text-sm text-red-700">{err}</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={() => window.print()} className="btn-outline text-sm">🖨 Print</button>
          <button onClick={del} disabled={busy} className="btn-outline text-sm text-red-600">🗑 Delete</button>
          <button onClick={save} disabled={busy} className="btn text-sm">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>

      <div className="print-doc rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between border-b-2 border-brand pb-4">
          <div>
            <div className="text-xl font-bold text-slate-900">Vista Group</div>
            <div className="text-sm text-slate-500">Visa Invoice</div>
          </div>
          <div className="text-right text-sm">
            <div className="text-lg font-bold text-brand">{invoice.doc_no}</div>
            <div className="text-slate-500">{dateStr(date)}</div>
            <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase text-slate-600">{invoice.status}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div><span className="text-slate-400">Customer: </span>{agentName || "—"}</div>
          <div><span className="text-slate-400">Supplier: </span>{supplierName || "—"}</div>
          <div><span className="text-slate-400">Haji Name: </span>{invoice.haji_name || "—"}</div>
          <div><span className="text-slate-400">Visa Type: </span>{invoice.visa_type} · {invoice.nights} nights</div>
        </div>

        <div className="overflow-x-auto">
        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="py-2">Item</th><th className="py-2 text-right">Qty (pax)</th>
              <th className="py-2 text-right">Rate</th><th className="py-2 text-right">Gross</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2">{invoice.item_name}</td>
              <td className="py-2 text-right tabular-nums">{invoice.pax}</td>
              <td className="py-2 text-right tabular-nums">
                <input className="input no-print w-24 text-right tabular-nums" inputMode="decimal" value={sellRate} onChange={(e) => setSellRate(e.target.value)} />
                <span className="hidden print:inline">{money(num(sellRate))}</span>
              </td>
              <td className="py-2 text-right tabular-nums">{money(gross)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td colSpan={3} className="py-1 text-right text-slate-500">Discount</td>
              <td className="py-1 text-right tabular-nums">
                <input className="input no-print w-24 text-right tabular-nums" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                <span className="hidden print:inline">{money(num(discount))}</span>
              </td></tr>
            <tr className="border-t-2 border-slate-200 font-bold"><td colSpan={3} className="py-2 text-right">Net Total</td>
              <td className="py-2 text-right tabular-nums text-brand">{money(net)}</td></tr>
          </tfoot>
        </table>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="no-print"><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="no-print"><label className="label">Supplier Rate (cost/pax)</label><input className="input text-right tabular-nums" inputMode="decimal" value={purRate} onChange={(e) => setPurRate(e.target.value)} /></div>
          <div className="col-span-2"><label className="label no-print">Narration</label>
            <input className="input no-print" value={narration} onChange={(e) => setNarration(e.target.value)} />
            {narration && <div className="hidden text-slate-500 print:block"><span className="text-slate-400">Narration: </span>{narration}</div>}
          </div>
          <div className="text-xs text-slate-400 no-print">Supplier cost (Dr Visa Cost / Cr {supplierName || "supplier"}): {money(cost)}</div>
        </div>
      </div>
    </div>
  );
}
