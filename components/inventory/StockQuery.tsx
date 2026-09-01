"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money, qtyf } from "./reportFormat";

type Node = { id: string; parent_id: string | null; name: string; is_group: boolean; uom: string | null; qty: number };
type Result = {
  item: { id: string; name: string; uom: string | null; purchase_rate: number; sell_rate: number;
          reorder_level: number; reorder_qty: number; group: string | null } | null;
  balances: { warehouse: string; qty: number; value: number; avg_cost: number }[];
  movements: { date: string; doc_no: string; doc_type: string; warehouse: string; qty: number; rate: number; value: number; name: string | null }[];
};

/** Query: everything known about one stock item on a single screen. */
export default function StockQuery() {
  const supabase = createClient();
  const [items, setItems] = useState<Node[]>([]);
  const [id, setId] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("stock_item_tree");
      setItems(((data as Node[]) ?? []).filter((n) => !n.is_group));
    })();
  }, [supabase]);

  useEffect(() => {
    if (!id) { setRes(null); return; }
    (async () => {
      setBusy(true);
      const { data } = await supabase.rpc("stock_item_query", { p_item: id });
      setBusy(false);
      setRes((data as Result) ?? null);
    })();
  }, [id, supabase]);

  const totQty = res?.balances.reduce((s, b) => s + Number(b.qty), 0) ?? 0;
  const totVal = res?.balances.reduce((s, b) => s + Number(b.value), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="label">Stock item</label>
          <select className="input" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">— select an item —</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        {items.length === 0 && <p className="text-xs text-amber-600">No stock items yet — mark products as stock items in Masters → Product Tree.</p>}
      </div>

      {busy && <p className="text-sm text-slate-400">Loading…</p>}
      {res?.item && (
        <>
          <div className="card grid gap-4 sm:grid-cols-4">
            <Fact label="Item" value={res.item.name} />
            <Fact label="Group" value={res.item.group ?? "—"} />
            <Fact label="Unit" value={res.item.uom ?? "—"} />
            <Fact label="On hand" value={`${qtyf(totQty)}${res.item.uom ? ` ${res.item.uom}` : ""}`} />
            <Fact label="Stock value" value={money(totVal)} />
            <Fact label="Purchase rate" value={money(res.item.purchase_rate)} />
            <Fact label="Sell rate" value={money(res.item.sell_rate)} />
            <Fact label="Reorder level / qty" value={`${qtyf(res.item.reorder_level)} / ${qtyf(res.item.reorder_qty)}`} />
          </div>

          <Section title="Balance by warehouse">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr><th className="px-3 py-2 text-left">Warehouse</th><th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Avg Cost</th><th className="px-3 py-2 text-right">Value</th></tr>
              </thead>
              <tbody>
                {res.balances.map((b, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2">{b.warehouse}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qtyf(b.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(b.avg_cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(b.value)}</td>
                  </tr>
                ))}
                {res.balances.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nothing on hand.</td></tr>}
              </tbody>
            </table>
          </Section>

          <Section title="Recent movements">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Voucher</th>
                  <th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Warehouse</th>
                  <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Value</th></tr>
              </thead>
              <tbody>
                {res.movements.map((m, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2">{m.date}</td>
                    <td className="px-3 py-2">{m.doc_no}</td>
                    <td className="px-3 py-2 text-slate-600">{m.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{m.warehouse}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${Number(m.qty) < 0 ? "text-danger-fg" : "text-green-700"}`}>{qtyf(m.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(m.rate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(m.value)}</td>
                  </tr>
                ))}
                {res.movements.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No movements yet.</td></tr>}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 font-medium text-slate-800">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="card overflow-x-auto p-0">{children}</div>
    </div>
  );
}
