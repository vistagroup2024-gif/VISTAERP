"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { dateStr } from "@/lib/format";
import SectionHeader from "@/components/reports/SectionHeader";

const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

type Row = {
  doc_id: string; doc_no: string; doc_date: string; customer: string; cost_centre: string;
  total: number; advance: number; advance_received: number; advance_balance: number;
};
type Receipt = { doc_id: string; id: string; receipt_no: string; receipt_date: string; amount: number };

// "Received" used to be a lump sum with no way to see which receipt(s) made
// it up. report_sale_orders() (migration 426) now also returns the actual
// car_receipts rows behind that sum — shown the same expandable way Phase 1
// already made Pending Orders show its lines.
export default function AdvanceReceiptTable({ title, rows, receipts }: { title: string; rows: Row[]; receipts: Receipt[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const receiptsByDoc = new Map<string, Receipt[]>();
  for (const r of receipts) {
    if (!receiptsByDoc.has(r.doc_id)) receiptsByDoc.set(r.doc_id, []);
    receiptsByDoc.get(r.doc_id)!.push(r);
  }
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div>
      <SectionHeader title={`${title} (${rows.length})`} />
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full min-w-[800px] text-sm">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr>
            <th className="px-4 py-2.5 w-8" />
            <th className="px-4 py-2.5 text-left"><span className="col-resize">Order No</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Date</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Customer</span></th><th className="px-4 py-2.5 text-left"><span className="col-resize">Cost Centre</span></th>
            <th className="px-4 py-2.5 text-right"><span className="col-resize">SO Amount</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Advance</span></th>
            <th className="px-4 py-2.5 text-right"><span className="col-resize">Received</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Balance</span></th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const rcpts = receiptsByDoc.get(r.doc_id) ?? [];
              const isOpen = open.has(r.doc_id);
              return (
                <Fragment key={r.doc_id}>
                  <tr className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                    <td className="td">
                      {rcpts.length > 0 && (
                        <button onClick={() => toggle(r.doc_id)} className="text-slate-400 hover:text-slate-700" aria-label={isOpen ? "Collapse" : "Expand"}>
                          {isOpen ? "▾" : "▸"}
                        </button>
                      )}
                    </td>
                    <td className="td"><Link href={`/accounting/sales/orders?id=${r.doc_id}`} className="text-brand hover:underline">{r.doc_no}</Link></td>
                    <td className="td">{dateStr(r.doc_date)}</td>
                    <td className="td">{r.customer}</td>
                    <td className="td">{r.cost_centre}</td>
                    <td className="td text-right tabular-nums">{money(r.total)}</td>
                    <td className="td text-right tabular-nums">{money(r.advance)}</td>
                    <td className="td text-right tabular-nums">{money(r.advance_received)}</td>
                    <td className={`td text-right tabular-nums font-medium ${Number(r.advance_balance) < 0 ? "text-red-600" : ""}`}>{money(r.advance_balance)}</td>
                  </tr>
                  {isOpen && rcpts.length > 0 && (
                    <tr className="border-t border-slate-100 bg-slate-50/60">
                      <td className="td" />
                      <td colSpan={8} className="px-3 py-2">
                        <table className="report-grid w-full text-xs">
                          <thead className="text-slate-400"><tr>
                            <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide"><span className="col-resize">Receipt No</span></th>
                            <th className="px-2 py-1 text-left font-semibold uppercase tracking-wide"><span className="col-resize">Date</span></th>
                            <th className="px-2 py-1 text-right font-semibold uppercase tracking-wide"><span className="col-resize">Amount</span></th>
                          </tr></thead>
                          <tbody>
                            {rcpts.map((rc, ri) => (
                              <tr key={rc.id} className={`border-t border-slate-200 ${ri % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                                <td className="px-2 py-1">{rc.receipt_no}</td>
                                <td className="px-2 py-1">{dateStr(rc.receipt_date)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{money(rc.amount)}</td>
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
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>None.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
