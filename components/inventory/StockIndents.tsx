"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { qtyf } from "./reportFormat";

type Low = { item_id: string; item: string; uom: string | null; qty: number; reorder_level: number; on_order: number; suggested: number };
type Indent = {
  id: string; doc_no: string; date: string; status: string; warehouse: string | null; narration: string | null;
  lines: { item: string; uom: string | null; qty: number; balance_qty: number; reorder_level: number }[];
};

/**
 * Raise Indents for Items with Low Stock: the reorder list on top with a tick
 * per item, and the indents already raised below. An indent is the internal
 * requisition a Purchase Order is then written from.
 */
export default function StockIndents() {
  const supabase = createClient();
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [wh, setWh] = useState("");
  const [low, setLow] = useState<Low[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [indents, setIndents] = useState<Indent[]>([]);
  const [narration, setNarration] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: l }, { data: ix }] = await Promise.all([
      supabase.rpc("stock_reorder_report", { p_wh: wh || null }),
      supabase.rpc("stock_indent_list", { p_from: null, p_to: null }),
    ]);
    const rows = (l as Low[]) ?? [];
    setLow(rows);
    setPicked(new Set(rows.map((r) => r.item_id)));   // everything low is ticked by default
    setIndents((ix as Indent[]) ?? []);
  }, [supabase, wh]);

  useEffect(() => {
    supabase.from("warehouses").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setWarehouses((data as any[]) ?? []));
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function raise() {
    setErr(null); setMsg(null);
    if (picked.size === 0) return setErr("Tick at least one item.");
    setBusy(true);
    const { data, error } = await supabase.rpc("stock_raise_indent", {
      p_wh: wh || null, p_items: Array.from(picked), p_narration: narration || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg(`Indent ${(data as any).doc_no} raised for ${(data as any).lines} item(s).`);
    setNarration("");
    load();
  }

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-6">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}

      <div className="card flex flex-wrap items-end gap-3">
        <div><label className="label">Warehouse</label>
          <select className="input w-44" value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></div>
        <div className="min-w-56 flex-1"><label className="label">Narration</label>
          <input className="input" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Optional note on the indent" /></div>
        <button className="btn h-[38px]" onClick={raise} disabled={busy || low.length === 0}>
          {busy ? "Raising…" : "Raise indent"}
        </button>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Items below their reorder level</h2>
        <div className="card overflow-x-auto p-0 text-sm">
          <table className="w-full">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr><th className="w-10 px-3 py-2" /><th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">On Hand</th><th className="px-3 py-2 text-right">Reorder Level</th>
                <th className="px-3 py-2 text-right">On Order</th><th className="px-3 py-2 text-right">Suggested Order</th></tr>
            </thead>
            <tbody>
              {low.map((r) => (
                <tr key={r.item_id} className="border-t border-slate-100">
                  <td className="px-3 py-2"><input type="checkbox" checked={picked.has(r.item_id)} onChange={() => toggle(r.item_id)} /></td>
                  <td className="px-3 py-2">{r.item}{r.uom ? <span className="text-slate-400"> · {r.uom}</span> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qtyf(r.qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qtyf(r.reorder_level)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qtyf(r.on_order)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{qtyf(r.suggested)}</td>
                </tr>
              ))}
              {low.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                Nothing is below its reorder level. Set a reorder level on an item in Masters → Product Tree to watch it here.
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Indents raised</h2>
        <div className="space-y-3">
          {indents.map((i) => (
            <div key={i.id} className="card p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <div className="text-sm"><b>{i.doc_no}</b> <span className="text-slate-400">· {i.date}</span>
                  {i.warehouse && <span className="text-slate-500"> · {i.warehouse}</span>}
                  {i.narration && <span className="text-slate-500"> · {i.narration}</span>}</div>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] uppercase text-slate-600">{i.status}</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {i.lines.map((l, k) => (
                    <tr key={k} className="border-t border-slate-100 first:border-t-0">
                      <td className="px-3 py-1.5">{l.item}{l.uom ? <span className="text-slate-400"> · {l.uom}</span> : null}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500">on hand {qtyf(l.balance_qty)} / level {qtyf(l.reorder_level)}</td>
                      <td className="w-28 px-3 py-1.5 text-right font-semibold tabular-nums">{qtyf(l.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {indents.length === 0 && <p className="card text-center text-sm text-slate-400">No indents raised yet.</p>}
        </div>
      </div>
    </div>
  );
}
