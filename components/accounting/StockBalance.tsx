"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { item: string; uom: string | null; warehouse: string; qty: number; value: number; avg_cost: number; reorder_level: number; low: boolean };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const qtyf = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(n) || 0);

export default function StockBalance() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { (async () => { const { data } = await supabase.rpc("stock_balance_report"); setRows((data as Row[]) ?? []); })(); }, [supabase]);
  const totVal = rows.reduce((s, r) => s + Number(r.value), 0);

  return (
    <div className="card overflow-x-auto p-0 text-sm">
      <table className="w-full">
        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Warehouse</th>
            <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Avg Cost</th><th className="px-3 py-2 text-right">Value</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-t border-slate-100 ${r.low ? "bg-red-50/50" : ""}`}>
              <td className="px-3 py-2">{r.item}{r.uom ? <span className="text-slate-400"> · {r.uom}</span> : null}{r.low && <span className="ml-2 rounded bg-red-100 px-1.5 text-[10px] uppercase text-red-600">low</span>}</td>
              <td className="px-3 py-2 text-slate-600">{r.warehouse}</td>
              <td className="px-3 py-2 text-right tabular-nums">{qtyf(r.qty)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.avg_cost)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.value)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No stock on hand.</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
          <td className="px-3 py-2" colSpan={4}>Total stock value</td><td className="px-3 py-2 text-right tabular-nums">{money(totVal)}</td>
        </tr></tfoot>}
      </table>
    </div>
  );
}
