"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type PendingDoc = {
  id: string; doc_no: string; doc_date: string; party_name: string | null;
  cost_center: string | null; reference: string | null; total: number; lines: number;
};

const money = (n: any) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

/**
 * The Load list: every upstream document nothing has carried forward yet.
 * Picking one fills this voucher from it — which is the whole point of the
 * chain, so the operator types only what the earlier document could not know.
 */
export default function LoadFromPicker({ targetType, sourceTitle, onPick, onClose, rpc, rpcArgs }: {
  targetType: string; sourceTitle: string;
  onPick: (id: string) => void; onClose: () => void;
  /** Which pending list to read. Defaults to the trade-document chain. */
  rpc?: string; rpcArgs?: Record<string, unknown>;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<PendingDoc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc(rpc ?? "trade_doc_pending", rpcArgs ?? { p_target_type: targetType });
      if (error) { setErr(error.message); setRows([]); return; }
      setRows((data as PendingDoc[]) ?? []);
    })();
  }, [supabase, targetType, rpc]);

  const list = (rows ?? []).filter((r) => {
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return [r.doc_no, r.party_name, r.reference].filter(Boolean).join(" ").toLowerCase().includes(s);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-800">Load from {sourceTitle}</h2>
            <p className="text-xs text-slate-400">Only documents that have not been loaded yet.</p>
          </div>
          <input className="input w-52" placeholder="Search no. / party…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="flex-1 overflow-y-auto">
          {err && <p className="px-4 py-3 text-sm text-danger-fg">{err}</p>}
          {rows === null && <p className="px-4 py-8 text-center text-sm text-slate-400">Loading…</p>}
          {rows !== null && list.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              No pending {sourceTitle.toLowerCase()} to load.
            </p>
          )}
          {list.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr><th className="px-4 py-2 text-left">Document</th><th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Party</th><th className="px-4 py-2 text-left">Cost Center</th>
                  <th className="px-4 py-2 text-right">Items</th><th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2" /></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-brand-50/40">
                    <td className="px-4 py-2 font-medium">{r.doc_no}</td>
                    <td className="px-4 py-2 text-slate-600">{r.doc_date}</td>
                    <td className="px-4 py-2 text-slate-600">{r.party_name ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-500">{r.cost_center ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.lines}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(r.total)}</td>
                    <td className="px-4 py-2 text-right">
                      <button className="btn text-xs" onClick={() => onPick(r.id)}>Load</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 px-4 py-3">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
