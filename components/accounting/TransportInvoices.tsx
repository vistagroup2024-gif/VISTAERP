"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";

type Row = { trip_id: string; doc: string; date: string; agent: string | null; route: string | null;
  sell: number; outsourced: boolean; vendor: string | null; vendor_cost: number; posted: boolean };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const y = new Date().getFullYear();

// Transport invoices = completed trips posted to the GL per trip (Dr Agent / Cr
// Transport Sales; outsourced adds Dr Transport Cost / Cr Vendor). Auto-posts on
// completion; this screen also lets staff post older completed trips.
export default function TransportInvoices() {
  const supabase = createClient();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [onlyUnposted, setOnlyUnposted] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const { data, error } = await supabase.rpc("transport_invoice_list", { p_from: from, p_to: to, p_only_unposted: onlyUnposted });
    if (error) return setErr(error.message);
    setRows((data as Row[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to, onlyUnposted]);

  async function post(r: Row) {
    setBusy(r.trip_id); setErr(null);
    const { data, error } = await supabase.rpc("transport_trip_post_gl", { p_trip: r.trip_id });
    setBusy(null);
    if (error) return setErr(error.message);
    if (!(data as any)?.posted) return setErr(`Not posted: ${(data as any)?.reason ?? "unknown"}`);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyUnposted} onChange={(e) => setOnlyUnposted(e.target.checked)} /> Only un-posted</label>
      </div>
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">Doc</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Route</th><th className="px-3 py-2 text-right">Sell</th>
              <th className="px-3 py-2 text-left">Vendor</th><th className="px-3 py-2 text-right">Vendor Cost</th>
              <th className="px-3 py-2 text-center">Status</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.trip_id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono">{r.doc}</td>
                <td className="px-3 py-2 text-slate-500">{dateStr(r.date)}</td>
                <td className="px-3 py-2">{r.agent ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.route ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.sell)}</td>
                <td className="px-3 py-2 text-slate-600">{r.outsourced ? (r.vendor ?? "—") : <span className="text-slate-400">in-house</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.outsourced ? money(r.vendor_cost) : ""}</td>
                <td className="px-3 py-2 text-center">
                  {r.posted ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] uppercase text-green-700">posted</span>
                    : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] uppercase text-amber-700">pending</span>}
                </td>
                <td className="px-3 py-2 text-right">{!r.posted && <button onClick={() => post(r)} disabled={busy === r.trip_id} className="text-brand hover:underline">{busy === r.trip_id ? "…" : "Post"}</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">No completed trips in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Trips post to the GL automatically when completed. Older completed trips can be posted here.</p>
    </div>
  );
}
