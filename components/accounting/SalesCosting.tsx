"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";

type Row = { source: string; doc_no: string; date: string; revenue: number; cost: number; profit: number; margin: number };
type ProdRow = {
  product_id: string; item: string; uom: string | null; qty: number; invoices: number;
  revenue: number; cost: number; cost_basis: "stock" | "rate"; profit: number; margin: number;
};
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const y = new Date().getFullYear();

export default function SalesCosting() {
  const supabase = createClient();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [prods, setProds] = useState<ProdRow[]>([]);
  // Two questions, not two screens: "what did each booking make?" and "what did
  // each item make?". They share the period, so they share the screen.
  const [tab, setTab] = useState<"doc" | "product">("doc");

  async function load() {
    const [{ data }, { data: pd }] = await Promise.all([
      supabase.rpc("report_sales_costing", { p_from: from, p_to: to }),
      supabase.rpc("report_product_costing", { p_from: from, p_to: to }),
    ]);
    setRows((data as Row[]) ?? []);
    setProds((pd as ProdRow[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);

  const t = rows.reduce((a, r) => ({ rev: a.rev + r.revenue, cost: a.cost + r.cost, profit: a.profit + r.profit }), { rev: 0, cost: 0, profit: 0 });
  const tMargin = t.rev ? Math.round((t.profit / t.rev) * 1000) / 10 : 0;
  const p = prods.reduce((a, r) => ({ rev: a.rev + r.revenue, cost: a.cost + r.cost, profit: a.profit + r.profit }), { rev: 0, cost: 0, profit: 0 });
  const pMargin = p.rev ? Math.round((p.profit / p.rev) * 1000) / 10 : 0;
  const estimated = prods.filter((r) => r.cost_basis === "rate").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="ml-auto inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
          {([["doc", "By document"], ["product", "By product"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${tab === k ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {tab === "product" ? (
      <>
      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Invoices</th><th className="px-3 py-2 text-right">Revenue</th>
              <th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Profit</th>
              <th className="px-3 py-2 text-right">Margin %</th></tr>
          </thead>
          <tbody>
            {prods.map((r) => (
              <tr key={r.product_id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">
                  {r.item}
                  {r.cost_basis === "rate" && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] font-semibold uppercase text-amber-700"
                          title="This item keeps no stock, so its cost is the Product Tree purchase rate, not what the goods cost">
                      est.
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.qty}{r.uom ? ` ${r.uom}` : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.invoices}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.revenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.cost)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.profit < 0 ? "text-red-600" : "text-green-700"}`}>{money(r.profit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.margin}%</td>
              </tr>
            ))}
            {prods.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Nothing sold in this period.</td></tr>}
          </tbody>
          {prods.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
            <td className="px-3 py-2" colSpan={3}>Total ({prods.length} items)</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(p.rev)}</td><td className="px-3 py-2 text-right tabular-nums">{money(p.cost)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(p.profit)}</td><td className="px-3 py-2 text-right tabular-nums">{pMargin}%</td>
          </tr></tfoot>}
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Cost is what the goods were carried at when they left stock — not the list price.
        {estimated > 0 && ` ${estimated} item${estimated === 1 ? "" : "s"} marked “est.” keep no stock, so their cost is the Product Tree purchase rate instead.`}
      </p>
      </>
      ) : (
      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Source</th><th className="px-3 py-2 text-left">Doc No.</th><th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-right">Revenue</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Profit</th><th className="px-3 py-2 text-right">Margin %</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-500">{r.source}</td>
                <td className="px-3 py-2 font-mono">{r.doc_no}</td>
                <td className="px-3 py-2 text-slate-500">{dateStr(r.date)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.revenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.cost)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.profit < 0 ? "text-red-600" : "text-green-700"}`}>{money(r.profit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.margin}%</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No costed sales in this period.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
            <td className="px-3 py-2" colSpan={3}>Total ({rows.length})</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(t.rev)}</td><td className="px-3 py-2 text-right tabular-nums">{money(t.cost)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(t.profit)}</td><td className="px-3 py-2 text-right tabular-nums">{tMargin}%</td>
          </tr></tfoot>}
        </table>
      </div>
      )}
    </div>
  );
}
