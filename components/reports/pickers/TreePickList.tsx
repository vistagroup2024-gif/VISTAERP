"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type TreeNode = { id: string; parent_id: string | null; name: string; is_group?: boolean };

/**
 * The tri-state tick-tree behind AccountPickTree, generalised to any
 * `{id, parent_id, name, is_group}` hierarchy — cost centres, tag areas,
 * product groups. Ticking a group ticks every LEAF under it (a leaf is any
 * node with `is_group` falsy), because that is what "Transport cost centre"
 * means as a filter: every cost centre under it, not the group itself, which
 * carries no postings of its own. A group's box is therefore on/off/some,
 * and clicking it toggles between all and none, exactly like the chart of
 * accounts picker it was pulled out of.
 *
 * `trailing` renders an optional right-aligned slot per leaf row (a quantity
 * balance, a code) so a caller like the stock item picker does not need its
 * own fork of this component for one extra column.
 */
export default function TreePickList<T extends TreeNode>({
  nodes, checked, onChange, trailing, searchPlaceholder = "Search…",
}: {
  nodes: T[];
  checked: Set<string>;
  onChange: (next: Set<string>) => void;
  trailing?: (node: T) => React.ReactNode;
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, T[]>();
    for (const n of nodes) {
      if (!m.has(n.parent_id)) m.set(n.parent_id, []);
      m.get(n.parent_id)!.push(n);
    }
    Array.from(m.values()).forEach((a) => a.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true })));
    return m;
  }, [nodes]);

  const leavesUnder = useMemo(() => {
    const m = new Map<string, string[]>();
    const walk = (n: T): string[] => {
      if (m.has(n.id)) return m.get(n.id)!;
      const kids = childrenOf.get(n.id) ?? [];
      const out = kids.length ? kids.flatMap(walk) : [];
      if (!n.is_group) out.unshift(n.id);
      m.set(n.id, out);
      return out;
    };
    nodes.forEach(walk);
    return m;
  }, [nodes, childrenOf]);

  const flat = useMemo(() => {
    const out: { n: T; depth: number }[] = [];
    const walk = (list: T[], depth: number) => {
      for (const n of list) {
        out.push({ n, depth });
        const kids = childrenOf.get(n.id) ?? [];
        if (!collapsed.has(n.id) && kids.length) walk(kids, depth + 1);
      }
    };
    walk(childrenOf.get(null) ?? [], 0);
    return out;
  }, [childrenOf, collapsed]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return nodes.filter((n) => !n.is_group && n.name.toLowerCase().includes(needle)).slice(0, 50);
  }, [q, nodes]);

  const place = useCallback(() => {
    const b = searchBoxRef.current?.getBoundingClientRect();
    if (!b) return;
    setRect({ left: b.left, top: b.bottom + 4, width: b.width });
  }, []);
  useLayoutEffect(() => { if (matches.length > 0) place(); }, [matches.length, place]);
  useEffect(() => {
    if (matches.length === 0) return;
    const onScroll = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!searchBoxRef.current?.contains(t) && !popupRef.current?.contains(t)) setQ("");
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", onDown);
    };
  }, [matches.length, place]);

  function pick(n: T) {
    const next = new Set(checked);
    next.add(n.id);
    onChange(next);
    setQ("");
  }

  function toggleNode(n: T) {
    const leaves = leavesUnder.get(n.id) ?? [];
    const next = new Set(checked);
    const allOn = leaves.length > 0 && leaves.every((id) => next.has(id));
    for (const id of leaves) { if (allOn) next.delete(id); else next.add(id); }
    onChange(next);
  }

  const state = (n: T): "on" | "off" | "some" => {
    const leaves = leavesUnder.get(n.id) ?? [];
    if (leaves.length === 0) return "off";
    const on = leaves.filter((id) => checked.has(id)).length;
    return on === 0 ? "off" : on === leaves.length ? "on" : "some";
  };

  const allLeaves = useMemo(() => nodes.filter((n) => !n.is_group).map((n) => n.id), [nodes]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={searchBoxRef} className="flex items-center gap-2 border-b border-slate-200 p-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder}
          className="input flex-1 py-1 text-sm" />
      </div>
      {matches.length > 0 && rect && (
        <div ref={popupRef}
          style={{ position: "fixed", left: rect.left, top: rect.top, width: Math.max(rect.width, 240), zIndex: 60 }}
          className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((n) => (
            <button key={n.id} type="button" onClick={() => pick(n)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-brand-50 ${checked.has(n.id) ? "text-brand-700" : "text-slate-700"}`}>
              <span className="min-w-0 flex-1 truncate">{n.name}</span>
              {checked.has(n.id) && <span className="shrink-0 text-xs text-brand">✓</span>}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-xs">
        <button type="button" onClick={() => onChange(new Set(allLeaves))} className="text-brand hover:underline">Select all</button>
        <button type="button" onClick={() => onChange(new Set())} className="text-slate-500 hover:underline">Unselect all</button>
        <span className="ml-auto text-slate-400">{checked.size} selected</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1 text-sm">
        {flat.map(({ n, depth }) => {
          const kids = childrenOf.get(n.id) ?? [];
          const st = state(n);
          const open = !collapsed.has(n.id);
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
              {trailing && !n.is_group && <span className="shrink-0 text-xs text-slate-400">{trailing(n)}</span>}
            </div>
          );
        })}
        {flat.length === 0 && <p className="p-6 text-center text-slate-400">Nothing matches.</p>}
      </div>
    </div>
  );
}
