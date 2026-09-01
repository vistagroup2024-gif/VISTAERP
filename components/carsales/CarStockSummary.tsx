"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { item: string; uom: string | null; group: string | null; qty: number; value: number; avg_cost: number };
type Summary = { total_qty: number; total_value: number; rows: Row[] };

const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const qtyf = (n: any) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(n) || 0);

/**
 * What is on the yard right now, read straight from the Inventory balances a
 * purchased car creates. View only — cars enter stock from a Purchase Voucher
 * and leave it when they are sold or delivered, never from this screen. It is
 * here so a user with Car Sales access alone can still see the stock without
 * being given the Inventory module.
 */
export default function CarStockSummary() {
  const supabase = createClient();
  const [data, setData] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: d } = await supabase.rpc("car_stock_summary");
      setData((d as Summary) ?? null);
    })();
  }, [supabase]);

  if (!data) return null;
  const rows = data.rows ?? [];

  return (
    <div className="card mb-4 p-0">
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">In stock</p>
          <p className="text-lg font-bold text-slate-900">
            {qtyf(data.total_qty)} car{Number(data.total_qty) === 1 ? "" : "s"}
            <span className="ml-2 text-sm font-medium text-slate-500">valued {money(data.total_value)}</span>
          </p>
        </div>
        <span className="text-sm text-brand-600">{open ? "Hide breakdown" : `Breakdown by model (${rows.length})`}</span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr><th className="px-4 py-2 text-left">Model</th><th className="px-4 py-2 text-left">Group</th>
                <th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Avg Cost</th>
                <th className="px-4 py-2 text-right">Value</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2">{r.item}{r.uom ? <span className="text-slate-400"> · {r.uom}</span> : null}</td>
                  <td className="px-4 py-2 text-slate-500">{r.group ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{qtyf(r.qty)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(r.avg_cost)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(r.value)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No cars on the yard. A car enters stock when its Purchase Voucher is posted.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
