"use client";

import { useMemo, useState } from "react";

export type PickNode = {
  id: string; code: string; name: string; is_group: boolean;
  is_postable: boolean; parent_id: string | null; path: string | null;
  sort_order?: number | null;
};

/**
 * The chart of accounts as a tick-list — the left pane of the old software's
 * Ledger dialog.
 *
 * Ticking a GROUP ticks every postable account under it, because that is what
 * somebody means by "the ledger of Vista Customers": all of them, not the group
 * itself, which carries no postings of its own. A group's box therefore shows
 * three states — all of its accounts, some of them, or none — and clicking it
 * is a toggle between all and none.
 */
export default function AccountPickTree({ nodes, checked, onChange }: {
  nodes: PickNode[]; checked: Set<string>; onChange: (next: Set<string>) => void;
}) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, PickNode[]>();
    for (const n of nodes) {
      if (!m.has(n.parent_id)) m.set(n.parent_id, []);
      m.get(n.parent_id)!.push(n);
    }
    Array.from(m.values()).forEach((a) => a.sort((x, y) =>
      (Number(x.sort_order ?? 0) - Number(y.sort_order ?? 0)) ||
      x.code.localeCompare(y.code, undefined, { numeric: true })));
    return m;
  }, [nodes]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Every postable account under a node, itself included.
  const leavesUnder = useMemo(() => {
    const m = new Map<string, string[]>();
    const walk = (n: PickNode): string[] => {
      if (m.has(n.id)) return m.get(n.id)!;
      const kids = childrenOf.get(n.id) ?? [];
      const out = kids.length ? kids.flatMap(walk) : [];
      if (n.is_postable) out.unshift(n.id);
      m.set(n.id, out);
      return out;
    };
    nodes.forEach(walk);
    return m;
  }, [nodes, childrenOf]);

  // A search shows what matched plus its ancestors, so a match keeps its place
  // in the tree rather than appearing as a loose row.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const keep = new Set<string>();
    for (const n of nodes) {
      if (`${n.code} ${n.name}`.toLowerCase().includes(needle)) {
        keep.add(n.id);
        let p = n.parent_id;
        while (p && !keep.has(p)) { keep.add(p); p = byId.get(p)?.parent_id ?? null; }
      }
    }
    return keep;
  }, [q, nodes, byId]);

  const flat = useMemo(() => {
    const out: { n: PickNode; depth: number }[] = [];
    const walk = (list: PickNode[], depth: number) => {
      for (const n of list) {
        if (visible && !visible.has(n.id)) continue;
        out.push({ n, depth });
        const kids = childrenOf.get(n.id) ?? [];
        if ((visible ? true : !collapsed.has(n.id)) && kids.length) walk(kids, depth + 1);
      }
    };
    walk(childrenOf.get(null) ?? [], 0);
    return out;
  }, [childrenOf, collapsed, visible]);

  function toggleNode(n: PickNode) {
    const leaves = leavesUnder.get(n.id) ?? [];
    const next = new Set(checked);
    const allOn = leaves.length > 0 && leaves.every((id) => next.has(id));
    for (const id of leaves) { if (allOn) next.delete(id); else next.add(id); }
    onChange(next);
  }

  const state = (n: PickNode): "on" | "off" | "some" => {
    const leaves = leavesUnder.get(n.id) ?? [];
    if (leaves.length === 0) return "off";
    const on = leaves.filter((id) => checked.has(id)).length;
    return on === 0 ? "off" : on === leaves.length ? "on" : "some";
  };

  const allLeaves = useMemo(
    () => nodes.filter((n) => n.is_postable).map((n) => n.id), [nodes]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 p-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the chart…"
          className="input flex-1 py-1 text-sm" />
      </div>
      <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-xs">
        <button type="button" onClick={() => onChange(new Set(allLeaves))} className="text-brand hover:underline">Select all</button>
        <button type="button" onClick={() => onChange(new Set())} className="text-slate-500 hover:underline">Unselect all</button>
        <span className="ml-auto text-slate-400">{checked.size} selected</span>
      </div>
      <div className="min-h-[16rem] flex-1 overflow-auto py-1 text-sm">
        {flat.map(({ n, depth }) => {
          const kids = childrenOf.get(n.id) ?? [];
          const st = state(n);
          const open = visible ? true : !collapsed.has(n.id);
          return (
            <div key={n.id} className="flex items-center gap-1 py-0.5 pr-2 hover:bg-brand-50/40"
                 style={{ paddingLeft: 4 + depth * 14 }}>
              {kids.length ? (
                <button type="button" className="w-4 shrink-0 text-slate-400 hover:text-slate-700"
                  onClick={() => setCollapsed((c) => {
                    const x = new Set(c); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x;
                  })}>{open ? "▾" : "▸"}</button>
              ) : <span className="w-4 shrink-0" />}
              <input type="checkbox" className="h-3.5 w-3.5 shrink-0"
                checked={st === "on"}
                ref={(el) => { if (el) el.indeterminate = st === "some"; }}
                onChange={() => toggleNode(n)} />
              <span onClick={() => toggleNode(n)}
                className={`min-w-0 flex-1 cursor-pointer truncate ${n.is_group ? "font-semibold text-slate-700" : "text-slate-600"}`}>
                {n.name}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-slate-300">{n.code}</span>
            </div>
          );
        })}
        {flat.length === 0 && <p className="p-6 text-center text-slate-400">Nothing matches.</p>}
      </div>
    </div>
  );
}
