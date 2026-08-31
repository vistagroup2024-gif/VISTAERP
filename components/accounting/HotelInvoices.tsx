"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";

type Row = { row_id: string; doc: string; date: string; agent: string | null; hotel: string | null;
  city: string | null; sell: number; supplier: string | null; cost: number; posted: boolean };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const y = new Date().getFullYear();

// Hotel invoices = vendor-confirmed purchase bookings posted to the GL per stay
// (Dr Agent / Cr Hotel Sales = sale; Dr Hotel Cost / Cr Supplier = purchase).
// Auto-posts on vendor confirmation; this screen also posts older ones on demand.
//
// The list is filtered on CHECK-IN, and a hotel is confirmed well before the
// guest arrives — so the window has to run forward, not stop at today the way a
// report of completed work does. Ending it today hid every upcoming stay, which
// is exactly the set this screen exists to act on.
export default function HotelInvoices() {
  const supabase = createClient();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(`${y + 1}-12-31`);
  const [onlyUnposted, setOnlyUnposted] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const { data, error } = await supabase.rpc("hotel_invoice_list", { p_from: from, p_to: to, p_only_unposted: onlyUnposted });
    if (error) return setErr(error.message);
    setRows((data as Row[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to, onlyUnposted]);

  async function post(r: Row) {
    setBusy(r.row_id); setErr(null);
    const { data, error } = await supabase.rpc("hotel_purchase_post_gl", { p_row: r.row_id });
    setBusy(null);
    if (error) return setErr(error.message);
    if (!(data as any)?.posted) return setErr(`Not posted: ${(data as any)?.reason ?? "unknown"}`);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">Check-in from</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">Check-in to</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyUnposted} onChange={(e) => setOnlyUnposted(e.target.checked)} /> Only un-posted</label>
      </div>
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Doc</th><th className="px-3 py-2 text-left">Check-in</th><th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Hotel</th><th className="px-3 py-2 text-right">Sell</th>
              <th className="px-3 py-2 text-left">Supplier</th><th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-center">Status</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row_id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono">{r.doc}</td>
                <td className="px-3 py-2 text-slate-500">{dateStr(r.date)}</td>
                <td className="px-3 py-2">{r.agent ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.hotel ?? "—"}{r.city ? <span className="text-slate-400"> · {r.city}</span> : null}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.sell)}</td>
                <td className="px-3 py-2 text-slate-600">{r.supplier ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.cost)}</td>
                <td className="px-3 py-2 text-center">
                  {r.posted ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] uppercase text-green-700">posted</span>
                    : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] uppercase text-amber-700">pending</span>}
                </td>
                <td className="px-3 py-2 text-right">{!r.posted && <button onClick={() => post(r)} disabled={busy === r.row_id} className="text-brand hover:underline">{busy === r.row_id ? "…" : "Post"}</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">No vendor-confirmed bookings in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Bookings post to the GL automatically when the vendor confirms. Older confirmed bookings can be posted here.</p>
    </div>
  );
}
