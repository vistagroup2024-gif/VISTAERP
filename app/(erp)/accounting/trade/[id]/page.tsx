import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import { dateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const TITLES: Record<string, string> = {
  purchase_order: "Purchase Order", purchase_voucher: "Purchase Voucher", purchase_return: "Purchase Return",
  mrn: "Material Receipt Note", sales_quotation: "Sales Quotation", sale_order: "Sale Order",
  sales_return: "Sales Return", delivery_note: "Delivery Note",
};

export default async function TradeDocPage({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: doc } = await sb.rpc("trade_doc_get", { p_id: params.id });
  if (!doc) return <div className="card text-slate-500">Document not found. <Link href="/accounting" className="text-brand hover:underline">Back</Link></div>;
  const d = doc as any;
  const lines = (d.lines ?? []) as any[];
  const title = TITLES[d.doc_type] ?? "Document";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex items-center gap-2">
        <Link href="/accounting" className="btn-outline text-sm">← Accounting</Link>
        <span className="ml-auto"><PrintButton /></span>
      </div>
      <div className="print-doc rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between border-b-2 border-brand pb-4">
          <div>
            <div className="text-xl font-bold text-slate-900">Vista Group</div>
            <div className="text-sm text-slate-500">{title}</div>
          </div>
          <div className="text-right text-sm">
            <div className="text-lg font-bold text-brand">{d.doc_no}</div>
            <div className="text-slate-500">{dateStr(d.doc_date)}</div>
            <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-600">{d.status}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {d.party_name && <div><span className="text-slate-400">Party: </span>{d.party_name}</div>}
          {d.reference && <div><span className="text-slate-400">Reference: </span>{d.reference}</div>}
          {d.cost_center && <div><span className="text-slate-400">Cost Center: </span>{d.cost_center}</div>}
          {d.tag_area && <div><span className="text-slate-400">Tag Area: </span>{d.tag_area}</div>}
          {d.mode_of_payment && <div><span className="text-slate-400">Mode: </span>{d.mode_of_payment}</div>}
          {d.due_date && <div><span className="text-slate-400">Due: </span>{dateStr(d.due_date)}</div>}
          {d.delivery_date && <div><span className="text-slate-400">Delivery: </span>{dateStr(d.delivery_date)}</div>}
        </div>

        <div className="overflow-x-auto">
        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="py-2">#</th><th className="py-2">Item</th><th className="py-2">Units</th>
              <th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 text-slate-400">{i + 1}</td>
                <td className="py-2">{l.item_name}</td>
                <td className="py-2 text-slate-500">{l.units}</td>
                <td className="py-2 text-right tabular-nums">{Number(l.quantity) ? Number(l.quantity) : ""}</td>
                <td className="py-2 text-right tabular-nums">{Number(l.rate) ? money(Number(l.rate)) : ""}</td>
                <td className="py-2 text-right tabular-nums">{money(Number(l.amount))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200"><td colSpan={5} className="py-2 text-right text-slate-500">Subtotal</td><td className="py-2 text-right tabular-nums">{money(Number(d.subtotal))}</td></tr>
            {Number(d.round_off) !== 0 && <tr><td colSpan={5} className="py-1 text-right text-slate-500">Round Off</td><td className="py-1 text-right tabular-nums">{money(Number(d.round_off))}</td></tr>}
            <tr className="border-t-2 border-slate-200 font-bold"><td colSpan={5} className="py-2 text-right">Net Total</td><td className="py-2 text-right tabular-nums text-brand">{money(Number(d.total))}</td></tr>
          </tfoot>
        </table>
        </div>

        {d.terms && <div className="mt-4 text-xs text-slate-500"><span className="font-semibold">Terms: </span>{d.terms}</div>}
        {d.narration && <div className="mt-1 text-xs text-slate-500"><span className="font-semibold">Narration: </span>{d.narration}</div>}
      </div>
    </div>
  );
}
