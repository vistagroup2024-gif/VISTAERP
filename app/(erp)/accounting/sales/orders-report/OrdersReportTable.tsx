"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";

const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const qty = (n: any) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(n) || 0);

type Row = {
  doc_id: string; doc_no: string; doc_date: string; delivery_date: string | null;
  cost_centre: string; status: string; consumed: boolean; terms: string | null; due_date: string | null;
  customer: string; total: number; advance: number; advance_received: number; advance_balance: number;
};
type Line = { doc_id: string; product: string; qty: number; rate: number; amount: number; stock: number };

// The Pending Sales Orders report used to be header-only — report_sale_orders()
// already computed a line-item breakdown (product/qty/rate/amount/stock) that
// simply wasn't rendered. Expanding a row shows it rather than sending
// someone to open the voucher just to see what was ordered.
export default function OrdersReportTable({ rows, lines }: { rows: Row[]; lines: Line[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const linesByDoc = new Map<string, Line[]>();
  for (const l of lines) {
    if (!linesByDoc.has(l.doc_id)) linesByDoc.set(l.doc_id, []);
    linesByDoc.get(l.doc_id)!.push(l);
  }
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="card overflow-x-auto p-0">
      <table className="report-grid w-full min-w-[1080px] text-sm">
        <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr>
          <th className="px-4 py-2.5 w-8" />
          <th className="px-4 py-2.5 text-left"><span className="col-resize">Order No</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Date</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Delivery</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Terms</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Due Date</span></th>
          <th className="px-4 py-2.5 text-left"><span className="col-resize">Customer</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Cost Centre</span></th>
          <th className="px-4 py-2.5 text-right"><span className="col-resize">Amount</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Advance</span></th>
          <th className="px-4 py-2.5 text-right"><span className="col-resize">Received</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Balance</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Status</span></th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const rowLines = linesByDoc.get(r.doc_id) ?? [];
            const isOpen = open.has(r.doc_id);
            return (
              <Fragment key={r.doc_id}>
                <tr className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
                  <td className="td">
                    {rowLines.length > 0 && (
                      <button onClick={() => toggle(r.doc_id)} className="text-slate-400 hover:text-slate-700" aria-label={isOpen ? "Collapse" : "Expand"}>
                        {isOpen ? "▾" : "▸"}
                      </button>
                    )}
                  </td>
                  <td className="td"><Link href={`/accounting/sales/orders?id=${r.doc_id}`} className="text-brand hover:underline">{r.doc_no}</Link></td>
                  <td className="td">{dateStr(r.doc_date)}</td>
                  <td className="td">{r.delivery_date ? dateStr(r.delivery_date) : "—"}</td>
                  <td className="td">{r.terms ?? "—"}</td>
                  <td className="td">{r.due_date ? dateStr(r.due_date) : "—"}</td>
                  <td className="td">{r.customer}</td>
                  <td className="td">{r.cost_centre}</td>
                  <td className="td text-right tabular-nums">{money(r.total)}</td>
                  <td className="td text-right tabular-nums">{money(r.advance)}</td>
                  <td className="td text-right tabular-nums">{money(r.advance_received)}</td>
                  <td className="td text-right tabular-nums font-medium">{money(r.advance_balance)}</td>
                  <td className="td">{r.consumed ? <span className="badge bg-green-100 text-green-700">Invoiced</span> : <span className="badge bg-amber-100 text-amber-700">Pending</span>}</td>
                </tr>
                {isOpen && rowLines.length > 0 && (
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td className="td" />
                    <td colSpan={12} className="px-3 py-2">
                      <table className="report-grid w-full text-xs">
                        <thead className="text-slate-400"><tr>
                          <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide"><span className="col-resize">Product</span></th>
                          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide"><span className="col-resize">Order Qty</span></th>
                          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide"><span className="col-resize">Stock</span></th>
                          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide"><span className="col-resize">Rate</span></th>
                          <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide"><span className="col-resize">Amount</span></th>
                        </tr></thead>
                        <tbody>
                          {rowLines.map((l, i) => (
                            <tr key={i} className={`border-t border-slate-200 ${i % 2 === 1 ? "bg-slate-50/70" : ""}`}>
                              <td className="px-2 py-1">{l.product}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{qty(l.qty)}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{qty(l.stock)}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{money(l.rate)}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{money(l.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={13}>Nothing here.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
