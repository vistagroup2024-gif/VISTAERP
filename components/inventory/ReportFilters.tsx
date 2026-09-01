"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type ItemNode = {
  id: string; parent_id: string | null; name: string; is_group: boolean;
  uom: string | null; qty: number; reorder_level: number; reorder_qty: number;
};

export interface Filters {
  from: string;
  to: string;
  asof: string;
  items: string[] | null;   // null = every item
  warehouse: string | null;
  movedOnly: boolean;
  limit: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function defaultFilters(): Filters {
  const now = new Date();
  return {
    from: iso(new Date(now.getFullYear(), 0, 1)),
    to: iso(now), asof: iso(now),
    items: null, warehouse: null, movedOnly: false, limit: 50,
  };
}

// Report Range presets, the same list the desktop dialog offers.
const RANGES: Record<string, (t: Date) => [string, string]> = {
  "Date Range": (t) => [iso(new Date(t.getFullYear(), 0, 1)), iso(t)],
  "Today": (t) => [iso(t), iso(t)],
  "This Month": (t) => [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)],
  "Last Month": (t) => [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))],
  "This Year": (t) => [iso(new Date(t.getFullYear(), 0, 1)), iso(t)],
  "Last Year": (t) => [iso(new Date(t.getFullYear() - 1, 0, 1)), iso(new Date(t.getFullYear() - 1, 11, 31))],
};

/**
 * The report dialog: report dates, warehouse, "moved masters only", and the
 * item tree with per-item quantity balances. `needs` decides which controls
 * appear, so one component serves every report.
 */
export default function ReportFilters({ needs, value, onChange, onRun, busy }: {
  needs: string[];
  value: Filters;
  onChange: (f: Filters) => void;
  onRun: () => void;
  busy?: boolean;
}) {
  const supabase = createClient();
  const [tree, setTree] = useState<ItemNode[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [range, setRange] = useState("Date Range");

  const wantsItems = needs.includes("items");
  const wantsDates = needs.includes("from") || needs.includes("to");
  const wantsAsOf = needs.includes("asof");

  useEffect(() => {
    (async () => {
      const [{ data: t }, { data: w }] = await Promise.all([
        wantsItems ? supabase.rpc("stock_item_tree") : Promise.resolve({ data: [] as any }),
        supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
      ]);
      setTree((t as ItemNode[]) ?? []);
      setWarehouses((w as any[]) ?? []);
    })();
  }, [supabase, wantsItems]);

  const set = (p: Partial<Filters>) => onChange({ ...value, ...p });
  const selectedCount = value.items?.length ?? 0;

  return (
    <>
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        {wantsDates && (
          <>
            <div>
              <label className="label">Report Range</label>
              <select className="input w-40" value={range}
                onChange={(e) => {
                  const k = e.target.value; setRange(k);
                  if (k !== "Date Range") { const [f, t] = RANGES[k](new Date()); set({ from: f, to: t }); }
                }}>
                {Object.keys(RANGES).map((k) => <option key={k}>{k}</option>)}
              </select>
            </div>
            <div><label className="label">From</label>
              <input type="date" className="input" value={value.from}
                onChange={(e) => { setRange("Date Range"); set({ from: e.target.value }); }} /></div>
            <div><label className="label">To</label>
              <input type="date" className="input" value={value.to}
                onChange={(e) => { setRange("Date Range"); set({ to: e.target.value }); }} /></div>
          </>
        )}
        {wantsAsOf && (
          <div><label className="label">As at</label>
            <input type="date" className="input" value={value.asof} onChange={(e) => set({ asof: e.target.value })} /></div>
        )}
        {needs.includes("warehouse") && (
          <div><label className="label">Warehouse</label>
            <select className="input w-44" value={value.warehouse ?? ""}
              onChange={(e) => set({ warehouse: e.target.value || null })}>
              <option value="">All warehouses</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
        )}
        {needs.includes("limit") && (
          <div><label className="label">Show top</label>
            <input type="number" min={1} className="input w-24 text-right tabular-nums" value={value.limit}
              onChange={(e) => set({ limit: Math.max(1, Number(e.target.value) || 1) })} /></div>
        )}
        {wantsItems && (
          <div><label className="label">Items</label>
            <button onClick={() => setPickerOpen(true)} className="btn-outline h-[38px]">
              {selectedCount === 0 ? "All items" : `${selectedCount} selected`}
            </button></div>
        )}
        {needs.includes("movedOnly") && (
          <label className="flex h-[38px] items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={value.movedOnly} onChange={(e) => set({ movedOnly: e.target.checked })} />
            Moved masters only
          </label>
        )}
        <button onClick={onRun} disabled={busy} className="btn h-[38px]">{busy ? "Running…" : "Run report"}</button>
      </div>

      {pickerOpen && (
        <ItemPicker tree={tree} selected={value.items}
          onCancel={() => setPickerOpen(false)}
          onOk={(ids) => { set({ items: ids }); setPickerOpen(false); }} />
      )}
    </>
  );
}

// The item tree from the desktop dialog: groups with their stock items and the
// current quantity balance, tick the ones to report on. No ticks = every item.
function ItemPicker({ tree, selected, onOk, onCancel }: {
  tree: ItemNode[]; selected: string[] | null;
  onOk: (ids: string[] | null) => void; onCancel: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(selected ?? []));
  const [q, setQ] = useState("");

  const byParent = useMemo(() => {
    const m = new Map<string | null, ItemNode[]>();
    for (const n of tree) { const k = n.parent_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(n); }
    return m;
  }, [tree]);

  const items = useMemo(() => tree.filter((n) => !n.is_group), [tree]);
  const match = (n: ItemNode) => !q.trim() || n.name.toLowerCase().includes(q.trim().toLowerCase());

  // A group is drawn only when it (or a descendant) still has a visible item.
  function visibleItems(groupId: string | null): ItemNode[] {
    const out: ItemNode[] = [];
    const walk = (id: string | null) => {
      for (const n of byParent.get(id) ?? []) { if (n.is_group) walk(n.id); else if (match(n)) out.push(n); }
    };
    walk(groupId);
    return out;
  }

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const qtyf = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(n) || 0);

  function Group({ node, depth }: { node: ItemNode; depth: number }) {
    const kids = byParent.get(node.id) ?? [];
    if (visibleItems(node.id).length === 0) return null;
    return (
      <div>
        <div className="flex items-center justify-between bg-slate-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600"
          style={{ paddingLeft: 12 + depth * 16 }}>
          <span>{node.name}</span>
          <button className="text-[11px] font-medium normal-case text-brand-600 hover:underline"
            onClick={() => setSel((s) => {
              const n = new Set(s); const vis = visibleItems(node.id);
              const allOn = vis.every((v) => n.has(v.id));
              for (const v of vis) allOn ? n.delete(v.id) : n.add(v.id);
              return n;
            })}>toggle group</button>
        </div>
        {kids.filter((k) => k.is_group).map((k) => <Group key={k.id} node={k} depth={depth + 1} />)}
        {kids.filter((k) => !k.is_group && match(k)).map((k) => <Leaf key={k.id} node={k} depth={depth + 1} />)}
      </div>
    );
  }

  function Leaf({ node, depth }: { node: ItemNode; depth: number }) {
    return (
      <label className="flex cursor-pointer items-center gap-2 border-b border-slate-100 py-1.5 pr-3 text-sm hover:bg-brand-50/40"
        style={{ paddingLeft: 12 + depth * 16 }}>
        <input type="checkbox" checked={sel.has(node.id)} onChange={() => toggle(node.id)} />
        <span className="flex-1 truncate">{node.name}{node.uom ? <span className="text-slate-400"> · {node.uom}</span> : null}</span>
        <span className="tabular-nums text-slate-500">{qtyf(node.qty)}</span>
      </label>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onCancel}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-800">Select items</h2>
          <input className="input w-48" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Name</span><span>Quantity Balance</span>
          </div>
          {tree.length === 0 && <p className="px-3 py-8 text-center text-sm text-slate-400">No stock items yet — mark products as stock items in Masters → Product Tree.</p>}
          {(byParent.get(null) ?? []).filter((n) => n.is_group).map((n) => <Group key={n.id} node={n} depth={0} />)}
          {(byParent.get(null) ?? []).filter((n) => !n.is_group && match(n)).map((n) => <Leaf key={n.id} node={n} depth={0} />)}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <div className="flex gap-2 text-sm">
            <button className="text-brand-600 hover:underline" onClick={() => setSel(new Set(items.map((i) => i.id)))}>Select all items</button>
            <span className="text-slate-300">|</span>
            <button className="text-brand-600 hover:underline" onClick={() => setSel(new Set())}>Unselect all</button>
          </div>
          <div className="flex gap-2">
            <button className="btn-outline" onClick={onCancel}>Cancel</button>
            <button className="btn" onClick={() => onOk(sel.size === 0 ? null : Array.from(sel))}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}
