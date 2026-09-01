"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ReportFilters, { defaultFilters, type Filters } from "./ReportFilters";
import { money, qtyf } from "./reportFormat";

type Entry = {
  date: string; voucher_no: string; name: string | null; doc_type: string;
  qty_rec: number; rate_rec: number; rec_value: number;
  qty_iss: number; rate_iss: number; iss_value: number;
  bal_qty: number; bal_value: number;
};
type ItemBlock = { item_id: string; item: string; uom: string | null; opening_qty: number; opening_value: number; rows: Entry[] };

const HEAD = ["Date", "Voucher No", "Name", "Qty Rec", "Rate", "Rec. Value",
  "Qty. Issues", "Rate", "Value of Issue", "Balance Qty", "Balance Value"];

/**
 * Stock Ledger: one block per item — opening balance, then every receipt and
 * issue with a running quantity and value balance, closed by a total row.
 */
export default function StockLedger() {
  const supabase = createClient();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [blocks, setBlocks] = useState<ItemBlock[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("stock_ledger_report", {
      p_from: filters.from, p_to: filters.to, p_items: filters.items,
      p_wh: filters.warehouse, p_moved_only: filters.movedOnly,
    });
    setBusy(false);
    if (error) { setErr(error.message); setBlocks([]); return; }
    setBlocks((data as ItemBlock[]) ?? []);
  }

  function csv() {
    const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [HEAD.map(esc).join(",")];
    for (const b of blocks ?? []) {
      lines.push(esc(b.item) + ",".repeat(HEAD.length - 1));
      lines.push([esc(""), esc("Opening"), esc(""), "", "", "", "", "", "", b.opening_qty, b.opening_value].join(","));
      for (const r of b.rows)
        lines.push([esc(r.date), esc(r.voucher_no), esc(r.name), r.qty_rec, r.rate_rec, r.rec_value,
          r.qty_iss, r.rate_iss, r.iss_value, r.bal_qty, r.bal_value].join(","));
    }
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "stock-ledger.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="print:hidden">
        <ReportFilters needs={["from", "to", "items", "warehouse", "movedOnly"]}
          value={filters} onChange={setFilters} onRun={run} busy={busy} />
      </div>
      {err && <div className="mb-3 rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {blocks === null && <p className="text-sm text-slate-400">Choose the range and run the report.</p>}
      {blocks?.length === 0 && <p className="card text-center text-sm text-slate-400">Nothing moved in this period.</p>}

      {blocks && blocks.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between print:hidden">
            <p className="text-sm text-slate-500">{blocks.length} item{blocks.length === 1 ? "" : "s"}</p>
            <div className="flex gap-2">
              <button className="btn-outline" onClick={() => window.print()}>Print</button>
              <button className="btn-outline" onClick={csv}>Excel (CSV)</button>
            </div>
          </div>
          <div className="card overflow-x-auto p-0 text-sm">
            <table className="w-full">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr>{HEAD.map((h, i) => (
                  <th key={i} className={`px-3 py-2 ${i >= 3 ? "text-right" : "text-left"}`}>{h}</th>
                ))}</tr>
              </thead>
              {blocks.map((b) => {
                const recQty = b.rows.reduce((s, r) => s + Number(r.qty_rec), 0);
                const recVal = b.rows.reduce((s, r) => s + Number(r.rec_value), 0);
                const issQty = b.rows.reduce((s, r) => s + Number(r.qty_iss), 0);
                const issVal = b.rows.reduce((s, r) => s + Number(r.iss_value), 0);
                const last = b.rows[b.rows.length - 1];
                return (
                  <tbody key={b.item_id}>
                    <tr className="bg-brand-50/60">
                      <td colSpan={HEAD.length} className="px-3 py-1.5 font-semibold text-slate-800">
                        {b.item}{b.uom ? <span className="font-normal text-slate-400"> · {b.uom}</span> : null}
                      </td>
                    </tr>
                    <tr className="border-t border-slate-100 text-slate-500">
                      <td className="px-3 py-1.5" colSpan={3}>Opening balance</td>
                      <td colSpan={6} />
                      <td className="px-3 py-1.5 text-right tabular-nums">{qtyf(b.opening_qty)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(b.opening_value)}</td>
                    </tr>
                    {b.rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">{r.date}</td>
                        <td className="px-3 py-1.5">{r.voucher_no}</td>
                        <td className="px-3 py-1.5 text-slate-600">{r.name || "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.qty_rec ? qtyf(r.qty_rec) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.qty_rec ? money(r.rate_rec) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.qty_rec ? money(r.rec_value) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.qty_iss ? qtyf(r.qty_iss) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.qty_iss ? money(r.rate_iss) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.qty_iss ? money(r.iss_value) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{qtyf(r.bal_qty)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(r.bal_value)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      <td className="px-3 py-1.5" colSpan={3}>Total</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{qtyf(recQty)}</td>
                      <td />
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(recVal)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{qtyf(issQty)}</td>
                      <td />
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(issVal)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{qtyf(last ? last.bal_qty : b.opening_qty)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(last ? last.bal_value : b.opening_value)}</td>
                    </tr>
                  </tbody>
                );
              })}
            </table>
          </div>
        </>
      )}
    </div>
  );
}
