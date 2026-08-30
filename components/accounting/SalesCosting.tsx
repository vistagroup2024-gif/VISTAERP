"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";

type Row = { source: string; doc_no: string; date: string; revenue: number; cost: number; profit: number; margin: number };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const y = new Date().getFullYear();

export default function SalesCosting() {
  const supabase = createClient();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);

  async function load() {
    const { data } = await supabase.rpc("report_sales_costing", { p_from: from, p_to: to });
    setRows((data as Row[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);

  const t = rows.reduce((a, r) => ({ rev: a.rev + r.revenue, cost: a.cost + r.cost, profit: a.profit + r.profit }), { rev: 0, cost: 0, profit: 0 });
  const tMargin = t.rev ? Math.round((t.profit / t.rev) * 1000) / 10 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
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
    </div>
  );
}
